import { MODULE_ID } from "../constants.js";
import { createAuraInstance, resolveAuraInstance } from "./aura-instance.js";

export const ACTOR_AURA_FLAG = "auraInstances";
export const AURA_ABILITY_FLAG = "auraAbility";

function clone(value) { return value == null ? value : structuredClone(value); }

function itemList(actor) {
  const items = actor?.items;
  if (!items) return [];
  if (Array.isArray(items)) return items;
  if (Array.isArray(items.contents)) return items.contents;
  try { return Array.from(items); } catch { return []; }
}

function auraAbilityFlag(item) {
  return item?.getFlag?.(MODULE_ID, AURA_ABILITY_FLAG)
    ?? item?.flags?.[MODULE_ID]?.[AURA_ABILITY_FLAG]
    ?? null;
}

function abilityDescription(definition) {
  return String(definition?.description ?? "");
}

function auraRuleSlug(definition, instance) {
  return `aura-forge-${String(definition?.id ?? instance?.definitionId ?? "aura")}-${String(instance?.id ?? "instance")}`
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function resolvedRadius(definition, instance) {
  const override = instance?.overrides?.radius;
  const value = override == null || override === "" ? definition?.radius : override;
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : 5;
}

export function createNativeAuraRule(definition, instance) {
  if (instance?.enabled === false) return null;
  return {
    key: "Aura",
    slug: auraRuleSlug(definition, instance),
    radius: resolvedRadius(definition, instance),
    traits: [],
    effects: [],
    mergeExisting: false
  };
}

/**
 * The owned PF2e ability is deliberately only a sheet-visible proxy. Aura
 * runtime state remains in the lightweight actor flag instance, and the
 * central library remains the source of truth for the aura definition.
 */
export function createAuraAbilitySource(definition, instance) {
  return {
    name: String(definition?.name || instance?.definitionName || "Aura"),
    type: "action",
    system: {
      description: { value: abilityDescription(definition) },
      actionType: { value: "passive" },
      actions: { value: null },
      category: "interaction",
      traits: { value: ["aura"], otherTags: [] },
      rules: (() => {
        const rule = createNativeAuraRule(definition, instance);
        return rule ? [rule] : [];
      })()
    },
    flags: {
      [MODULE_ID]: {
        [AURA_ABILITY_FLAG]: {
          managed: true,
          instanceId: instance.id,
          definitionId: instance.definitionId
        }
      }
    }
  };
}

export class ActorAuraService {
  constructor({ library }) { this.library = library; }

  list(actor) {
    const raw = actor?.getFlag?.(MODULE_ID, ACTOR_AURA_FLAG);
    return Array.isArray(raw) ? raw.map((x) => createAuraInstance(x)) : [];
  }

  async #write(actor, instances) {
    if (!actor?.setFlag) throw new Error("A valid Actor document is required.");
    await actor.setFlag(MODULE_ID, ACTOR_AURA_FLAG, instances.map(clone));
    return this.list(actor);
  }

  #findAbility(actor, instanceId) {
    return itemList(actor).find((item) => auraAbilityFlag(item)?.instanceId === instanceId) ?? null;
  }

  #abilityUpdate(item, definition, instance) {
    const source = createAuraAbilitySource(definition, instance);
    return {
      _id: item.id,
      name: source.name,
      "system.description.value": source.system.description.value,
      "system.actionType.value": "passive",
      "system.actions.value": null,
      "system.category": "interaction",
      "system.traits.value": ["aura"],
      "system.rules": clone(source.system.rules),
      [`flags.${MODULE_ID}.${AURA_ABILITY_FLAG}`]: source.flags[MODULE_ID][AURA_ABILITY_FLAG]
    };
  }

  async #ensureAbility(actor, instance, definition = null) {
    definition ??= await this.library.get(instance.definitionId);
    if (!definition) return null;

    const current = this.#findAbility(actor, instance.id);
    if (current) {
      if (typeof actor?.updateEmbeddedDocuments === "function") {
        const [updated] = await actor.updateEmbeddedDocuments("Item", [this.#abilityUpdate(current, definition, instance)]);
        return updated ?? current;
      }
      return current;
    }

    if (typeof actor?.createEmbeddedDocuments !== "function") {
      throw new Error("Actor does not support embedded Item creation.");
    }
    const [created] = await actor.createEmbeddedDocuments("Item", [createAuraAbilitySource(definition, instance)]);
    return created ?? null;
  }

  async #deleteAbility(actor, instanceId) {
    const current = this.#findAbility(actor, instanceId);
    if (!current || typeof actor?.deleteEmbeddedDocuments !== "function") return false;
    await actor.deleteEmbeddedDocuments("Item", [current.id]);
    return true;
  }

  async assign(actor, definitionId, { enabled = true, overrides = {} } = {}) {
    const definition = await this.library.get(definitionId);
    if (!definition) throw new Error(`Unknown aura definition: ${definitionId}`);
    const instances = this.list(actor);
    const existing = instances.find((x) => x.definitionId === definitionId);
    if (existing) {
      await this.#ensureAbility(actor, existing, definition);
      return existing;
    }

    const instance = createAuraInstance({ definitionId, definitionName: definition.name, enabled, overrides });
    instances.push(instance);
    await this.#write(actor, instances);
    try {
      await this.#ensureAbility(actor, instance, definition);
    } catch (error) {
      await this.#write(actor, instances.filter((x) => x.id !== instance.id));
      throw error;
    }
    return instance;
  }

  async remove(actor, instanceId) {
    const current = this.list(actor);
    const next = current.filter((x) => x.id !== instanceId);
    if (next.length === current.length) return false;
    await this.#write(actor, next);
    await this.#deleteAbility(actor, instanceId);
    return true;
  }

  async setEnabled(actor, instanceId, enabled) {
    const instances = this.list(actor);
    const item = instances.find((x) => x.id === instanceId);
    if (!item) return null;
    item.enabled = Boolean(enabled);
    await this.#write(actor, instances);
    await this.#ensureAbility(actor, item);
    return item;
  }

  async setRadiusOverride(actor, instanceId, value) {
    const instances = this.list(actor);
    const item = instances.find((x) => x.id === instanceId);
    if (!item) return null;
    item.overrides.radius = value === "" || value == null ? null : Number(value);
    await this.#write(actor, instances);
    await this.#ensureAbility(actor, item);
    return item;
  }

  async resolve(actor, instanceId) {
    const instance = this.list(actor).find((x) => x.id === instanceId);
    if (!instance) return null;
    const definition = await this.library.get(instance.definitionId);
    return { instance, definition, resolved: resolveAuraInstance(instance, definition), missingDefinition: !definition };
  }

  async assignmentsForDefinition(definitionId, actors = []) {
    const result = [];
    for (const actor of actors) {
      for (const instance of this.list(actor)) {
        if (instance.definitionId === definitionId) result.push({ actor, instance });
      }
    }
    return result;
  }

  /** Ensure legacy flag-only assignments gain their sheet-visible PF2e ability. */
  async reconcileActor(actor) {
    const instances = this.list(actor);
    const validIds = new Set(instances.map((x) => x.id));
    let createdOrUpdated = 0;
    let removedOrphans = 0;

    for (const instance of instances) {
      const definition = await this.library.get(instance.definitionId);
      if (!definition) continue;
      await this.#ensureAbility(actor, instance, definition);
      createdOrUpdated += 1;
    }

    const orphanIds = itemList(actor)
      .filter((item) => {
        const flag = auraAbilityFlag(item);
        return flag?.managed === true && flag.instanceId && !validIds.has(flag.instanceId);
      })
      .map((item) => item.id)
      .filter(Boolean);
    if (orphanIds.length > 0 && typeof actor?.deleteEmbeddedDocuments === "function") {
      await actor.deleteEmbeddedDocuments("Item", orphanIds);
      removedOrphans = orphanIds.length;
    }

    return { instances: instances.length, synced: createdOrUpdated, removedOrphans };
  }

  async reconcileAll(actors = []) {
    const reports = [];
    for (const actor of actors) {
      try {
        reports.push({ actor, report: await this.reconcileActor(actor), error: null });
      } catch (error) {
        reports.push({ actor, report: null, error });
      }
    }
    return reports;
  }

  /** Refresh actor ability proxies when the central aura definition changes. */
  async syncDefinition(definitionId, actors = []) {
    let synced = 0;
    const definition = await this.library.get(definitionId);
    if (!definition) return synced;
    for (const actor of actors) {
      for (const instance of this.list(actor)) {
        if (instance.definitionId !== definitionId) continue;
        await this.#ensureAbility(actor, instance, definition);
        synced += 1;
      }
    }
    return synced;
  }

  async removeDefinitionReferences(definitionId, actors = []) {
    let removed = 0;
    for (const actor of actors) {
      const current = this.list(actor);
      const removedInstances = current.filter((x) => x.definitionId === definitionId);
      const next = current.filter((x) => x.definitionId !== definitionId);
      removed += removedInstances.length;
      if (next.length !== current.length) {
        await this.#write(actor, next);
        for (const instance of removedInstances) await this.#deleteAbility(actor, instance.id);
      }
    }
    return removed;
  }
}
