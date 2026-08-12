import { AURA_INSTANCE_SCHEMA_VERSION } from "../constants.js";
import { createId } from "../aura/aura-definition.js";

function clone(value) { return value == null ? value : structuredClone(value); }

export function createAuraInstance(overrides = {}) {
  return {
    ...clone(overrides),
    schemaVersion: AURA_INSTANCE_SCHEMA_VERSION,
    id: overrides.id ?? createId("aura-instance"),
    definitionId: String(overrides.definitionId ?? ""),
    definitionName: String(overrides.definitionName ?? ""),
    enabled: overrides.enabled !== false,
    overrides: {
      radius: overrides?.overrides?.radius ?? null,
      ...clone(overrides.overrides ?? {})
    }
  };
}

export function resolveAuraInstance(instance, definition) {
  if (!instance || !definition) return null;
  const resolved = structuredClone(definition);
  if (instance.overrides?.radius != null && Number.isFinite(Number(instance.overrides.radius))) {
    resolved.radius = Number(instance.overrides.radius);
  }
  resolved.enabled = Boolean(definition.enabled && instance.enabled);
  resolved.instanceId = instance.id;
  resolved.definitionId = instance.definitionId;
  return resolved;
}
