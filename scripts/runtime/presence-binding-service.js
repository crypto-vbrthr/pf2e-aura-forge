import { EFFECT_FORGE_MODULE_ID, MODULE_ID } from "../constants.js";
import { repairMalformedPhysicalDescriptions } from "./actor-data-guard.js";
import { buildRuntimePresenceBindingKey } from "../engine/presence-reconciliation.js";

export const PRESENCE_BINDING_FLAG = "presenceBinding";
export const PRESENCE_BINDING_METADATA = "auraPresenceBinding";

function clone(value) {
  if (value == null) return value;
  const deepClone = globalThis.foundry?.utils?.deepClone;
  return typeof deepClone === "function" ? deepClone(value) : structuredClone(value);
}

function itemList(actor) {
  const items = actor?.items;
  if (!items) return [];
  if (Array.isArray(items)) return items;
  if (Array.isArray(items.contents)) return items.contents;
  try { return Array.from(items); } catch { return []; }
}

/**
 * Read the Aura Forge binding from an applied Effect Item.
 *
 * 0.3.3 stores the binding inside the public Effect Definition metadata that
 * Critical Forge persists in its documented module flags. The legacy direct
 * Aura Forge item flag remains readable so worlds created with 0.3.0-0.3.2
 * clean themselves up without migration churn.
 */
export function presenceBindingFlag(item) {
  const legacy = item?.getFlag?.(MODULE_ID, PRESENCE_BINDING_FLAG)
    ?? item?.flags?.[MODULE_ID]?.[PRESENCE_BINDING_FLAG]
    ?? null;
  if (legacy?.key) return legacy;

  return item?.flags?.[EFFECT_FORGE_MODULE_ID]?.definition?.metadata?.[PRESENCE_BINDING_METADATA]
    ?? null;
}

export function buildRuntimePresenceKey(options) {
  return buildRuntimePresenceBindingKey(options);
}

export function effectFingerprint(effect) {
  return JSON.stringify(effect ?? null);
}

export function createPresenceBinding(desired) {
  return {
    key: desired.key,
    sceneId: desired.sceneId,
    auraId: desired.auraId,
    instanceId: desired.instanceId,
    presenceEffectId: desired.presenceEffectId,
    sourceActorUuid: desired.sourceActorUuid,
    sourceTokenId: desired.sourceTokenId,
    targetActorUuid: desired.targetActorUuid,
    targetTokenIds: [...(desired.targetTokenIds ?? [])],
    effectFingerprint: desired.effectFingerprint
  };
}

export function preparePresenceEffect(effect, binding = null) {
  const prepared = clone(effect);
  if (!prepared) return null;
  prepared.duration = { value: -1, unit: "unlimited", expiry: null };
  prepared.metadata = {
    ...(prepared.metadata ?? {}),
    originModule: MODULE_ID,
    originFeature: "aura-presence",
    ...(binding ? { [PRESENCE_BINDING_METADATA]: clone(binding) } : {})
  };
  return prepared;
}

export function collectPresenceBindings(actors = [], { sceneId = null } = {}) {
  const groups = new Map();
  for (const actor of actors) {
    for (const item of itemList(actor)) {
      const flag = presenceBindingFlag(item);
      if (!flag?.key) continue;
      if (sceneId != null && flag.sceneId !== sceneId) continue;
      const group = groups.get(flag.key) ?? { key: flag.key, actor, flag, items: [] };
      group.items.push(item);
      groups.set(flag.key, group);
    }
  }
  return groups;
}

export class PresenceBindingService {
  constructor({ effectApi }) {
    this.effectApi = effectApi;
  }

  async apply(actor, desired) {
    if (!actor || !desired?.effect) return [];
    await repairMalformedPhysicalDescriptions(actor);
    const binding = createPresenceBinding(desired);
    const definition = preparePresenceEffect(desired.effect, binding);
    return this.effectApi.effects.apply(definition, actor, {
      context: {
        source: "aura-presence",
        auraId: desired.auraId,
        instanceId: desired.instanceId,
        sourceTokenId: desired.sourceTokenId
      }
    });
  }

  async removeGroup(group) {
    const actor = group?.actor;
    const ids = (group?.items ?? []).map((item) => item?.id).filter(Boolean);
    if (actor && ids.length > 0) await repairMalformedPhysicalDescriptions(actor);
    if (actor && ids.length > 0 && typeof actor.deleteEmbeddedDocuments === "function") {
      await actor.deleteEmbeddedDocuments("Item", ids);
      return ids;
    }
    for (const item of group?.items ?? []) await item?.delete?.({ render: false });
    return ids;
  }
}
