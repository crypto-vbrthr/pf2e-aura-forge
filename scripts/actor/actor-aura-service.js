import { MODULE_ID } from "../constants.js";
import { createAuraInstance, resolveAuraInstance } from "./aura-instance.js";
import { createAuraDefinition } from "../aura/aura-definition.js";
import { validateAuraDefinition } from "../aura/aura-validator.js";

export const ACTOR_AURA_FLAG = "auraInstances";
export const AURA_ABILITY_FLAG = "auraAbility";

function clone(value) { return value == null ? value : structuredClone(value); }

function assertValidLocalDefinition(definition) {
  const normalized = createAuraDefinition(definition);
  const report = validateAuraDefinition(normalized);
  if (!report.valid) {
    const error = new Error(report.errors.map((entry) => entry.message).join("; ") || "Aura definition is invalid.");
    error.name = "AuraDefinitionValidationError";
    error.code = "AURA_DEFINITION_INVALID";
    error.validation = report;
    throw error;
  }
  return normalized;
}

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

function collectionContents(collection) {
  if (!collection) return [];
  if (Array.isArray(collection)) return collection;
  if (Array.isArray(collection.contents)) return collection.contents;
  try { return Array.from(collection); } catch { return []; }
}

function sameUser(a, b) {
  return Boolean(a && b && String(a.id ?? a._id ?? "") !== ""
    && String(a.id ?? a._id) === String(b.id ?? b._id));
}

/**
 * Automatic proxy reconciliation is multi-client code. Exactly one active
 * client is allowed to write a given Actor: PF2e's primaryUpdater when
 * available, otherwise a deterministic active owner/GM fallback. Explicit
 * user-initiated assignment methods remain governed by normal Foundry
 * permissions and are not filtered through this helper.
 */
export function canReconcileAuraActor(actor, gameRef = globalThis.game) {
  const user = gameRef?.user;
  if (!user) return true; // unit/offline contexts
  if (!actor) return false;
  if (actor.primaryUpdater) return sameUser(actor.primaryUpdater, user);

  const active = collectionContents(gameRef?.users).filter((entry) => entry?.active !== false);
  const gm = gameRef?.users?.activeGM
    ?? active.filter((entry) => entry?.isGM).sort((a, b) => String(a.id ?? "").localeCompare(String(b.id ?? "")))[0]
    ?? null;
  if (gm) return sameUser(gm, user);

  const owners = active
    .filter((entry) => {
      if (typeof actor.testUserPermission === "function") {
        try { return actor.testUserPermission(entry, "OWNER"); } catch { /* fall through */ }
      }
      if (typeof actor.canUserModify === "function") {
        try { return actor.canUserModify(entry, "update"); } catch { return false; }
      }
      return false;
    })
    .sort((a, b) => String(a.id ?? "").localeCompare(String(b.id ?? "")));
  const writer = owners[0] ?? active.sort((a, b) => String(a.id ?? "").localeCompare(String(b.id ?? "")))[0] ?? user;
  return sameUser(writer, user);
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
 * runtime state remains in the Actor flag instance. Library-backed instances
 * resolve against the central Aura Library; Actor-local instances resolve
 * against their owned definition snapshot.
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
          definitionId: instance.definitionId,
          definitionScope: instance.definitionScope ?? "library"
        }
      }
    }
  };
}


function stableJson(value) {
  return JSON.stringify(value ?? null);
}

/** Return true only when the managed proxy differs from its desired source. */
export function auraAbilityNeedsSync(item, definition, instance) {
  if (!item) return true;
  const desired = createAuraAbilitySource(definition, instance);
  const currentFlag = auraAbilityFlag(item);
  return String(item.name ?? "") !== desired.name
    || String(item.system?.description?.value ?? "") !== desired.system.description.value
    || item.system?.actionType?.value !== "passive"
    || (item.system?.actions?.value ?? null) !== null
    || item.system?.category !== "interaction"
    || stableJson(item.system?.traits?.value ?? []) !== stableJson(["aura"])
    || stableJson(item.system?.rules ?? []) !== stableJson(desired.system.rules)
    || stableJson(currentFlag) !== stableJson(desired.flags[MODULE_ID][AURA_ABILITY_FLAG]);
}

export class ActorAuraService {
  constructor({ library, gameRef = globalThis.game } = {}) {
    this.library = library;
    this.gameRef = gameRef;
  }

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

  async #definitionForInstance(instance) {
    if (!instance) return null;
    if (instance.definitionScope === "actor") return clone(instance.definitionSnapshot ?? null);
    return this.library.get(instance.definitionId);
  }

  async #ensureAbility(actor, instance, definition = null) {
    definition ??= await this.#definitionForInstance(instance);
    if (!definition) return null;

    const current = this.#findAbility(actor, instance.id);
    if (current) {
      if (!auraAbilityNeedsSync(current, definition, instance)) return current;
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
    const existing = instances.find((x) => x.definitionScope !== "actor" && x.definitionId === definitionId);
    if (existing) {
      await this.#ensureAbility(actor, existing, definition);
      return existing;
    }

    const instance = createAuraInstance({
      definitionId,
      definitionName: definition.name,
      definitionScope: "library",
      definitionSnapshot: null,
      enabled,
      overrides
    });
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

  /**
   * Assign an Actor-local Aura Definition snapshot without adding it to the
   * world Aura Library. This is intended for generated/owned creature auras.
   * Reassigning the same local definition id refreshes the existing snapshot.
   */
  async assignDefinition(actor, definition, { enabled = true, overrides = {} } = {}) {
    const normalized = assertValidLocalDefinition(definition);
    const instances = this.list(actor);
    const existing = instances.find((x) => x.definitionScope === "actor" && x.definitionId === normalized.id);
    if (existing) {
      const previous = clone(existing);
      existing.definitionName = normalized.name;
      existing.definitionSnapshot = clone(normalized);
      await this.#write(actor, instances);
      try {
        await this.#ensureAbility(actor, existing, normalized);
      } catch (error) {
        const rollback = instances.map((entry) => entry.id === previous.id ? previous : entry);
        await this.#write(actor, rollback);
        await this.#ensureAbility(actor, previous, previous.definitionSnapshot);
        throw error;
      }
      return existing;
    }

    const instance = createAuraInstance({
      definitionId: normalized.id,
      definitionName: normalized.name,
      definitionScope: "actor",
      definitionSnapshot: normalized,
      enabled,
      overrides
    });
    instances.push(instance);
    await this.#write(actor, instances);
    try {
      await this.#ensureAbility(actor, instance, normalized);
    } catch (error) {
      await this.#write(actor, instances.filter((x) => x.id !== instance.id));
      throw error;
    }
    return instance;
  }

  /** Update an existing Actor-local Aura Definition snapshot in place. */
  async updateDefinition(actor, instanceId, definition) {
    const instances = this.list(actor);
    const instance = instances.find((entry) => entry.id === instanceId);
    if (!instance) return null;
    if (instance.definitionScope !== "actor") {
      const error = new Error("Only Actor-local aura definitions can be updated through updateDefinition().");
      error.code = "AURA_INSTANCE_NOT_ACTOR_LOCAL";
      throw error;
    }

    const normalized = assertValidLocalDefinition(definition);
    if (normalized.id !== instance.definitionId) {
      const error = new Error("Actor-local aura definition id cannot be changed after assignment.");
      error.code = "AURA_DEFINITION_ID_IMMUTABLE";
      throw error;
    }

    const previous = clone(instance);
    instance.definitionName = normalized.name;
    instance.definitionSnapshot = clone(normalized);
    await this.#write(actor, instances);
    try {
      await this.#ensureAbility(actor, instance, normalized);
    } catch (error) {
      const rollback = instances.map((entry) => entry.id === previous.id ? previous : entry);
      await this.#write(actor, rollback);
      await this.#ensureAbility(actor, previous, previous.definitionSnapshot);
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
    if (value === "" || value == null) item.overrides.radius = null;
    else {
      const radius = Number(value);
      if (!Number.isFinite(radius) || radius <= 0) {
        throw new RangeError("Aura radius override must be null or a finite number greater than 0.");
      }
      item.overrides.radius = radius;
    }
    await this.#write(actor, instances);
    await this.#ensureAbility(actor, item);
    return item;
  }

  async resolve(actor, instanceId) {
    const instance = this.list(actor).find((x) => x.id === instanceId);
    if (!instance) return null;
    const definition = await this.#definitionForInstance(instance);
    return {
      instance,
      definition,
      resolved: resolveAuraInstance(instance, definition),
      missingDefinition: !definition,
      definitionScope: instance.definitionScope ?? "library"
    };
  }

  async assignmentsForDefinition(definitionId, actors = []) {
    const result = [];
    for (const actor of actors) {
      for (const instance of this.list(actor)) {
        if (instance.definitionScope !== "actor" && instance.definitionId === definitionId) result.push({ actor, instance });
      }
    }
    return result;
  }

  /** Ensure legacy flag-only assignments gain their sheet-visible PF2e ability. */
  async reconcileActor(actor) {
    const instances = this.list(actor);
    if (!canReconcileAuraActor(actor, this.gameRef)) {
      return { instances: instances.length, synced: 0, unchanged: 0, removedOrphans: 0, skippedWriter: true };
    }
    const validIds = new Set(instances.map((x) => x.id));
    let createdOrUpdated = 0;
    let unchanged = 0;
    let removedOrphans = 0;

    for (const instance of instances) {
      const definition = await this.#definitionForInstance(instance);
      if (!definition) continue;
      const current = this.#findAbility(actor, instance.id);
      const needsSync = !current || auraAbilityNeedsSync(current, definition, instance);
      await this.#ensureAbility(actor, instance, definition);
      if (needsSync) createdOrUpdated += 1;
      else unchanged += 1;
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

    return { instances: instances.length, synced: createdOrUpdated, unchanged, removedOrphans, skippedWriter: false };
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
      if (!canReconcileAuraActor(actor, this.gameRef)) continue;
      for (const instance of this.list(actor)) {
        if (instance.definitionScope === "actor" || instance.definitionId !== definitionId) continue;
        const current = this.#findAbility(actor, instance.id);
        if (current && !auraAbilityNeedsSync(current, definition, instance)) continue;
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
      const removedInstances = current.filter((x) => x.definitionScope !== "actor" && x.definitionId === definitionId);
      const next = current.filter((x) => x.definitionScope === "actor" || x.definitionId !== definitionId);
      removed += removedInstances.length;
      if (next.length !== current.length) {
        await this.#write(actor, next);
        for (const instance of removedInstances) await this.#deleteAbility(actor, instance.id);
      }
    }
    return removed;
  }
}
