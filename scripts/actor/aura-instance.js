import { AURA_INSTANCE_SCHEMA_VERSION } from "../constants.js";
import { createId } from "../aura/aura-definition.js";

function clone(value) { return value == null ? value : structuredClone(value); }

export const AURA_DEFINITION_SCOPES = Object.freeze(["library", "actor"]);

function normalizedDefinitionScope(overrides = {}) {
  if (AURA_DEFINITION_SCOPES.includes(overrides.definitionScope)) return overrides.definitionScope;
  return overrides.definitionSnapshot && typeof overrides.definitionSnapshot === "object" ? "actor" : "library";
}

export function createAuraInstance(overrides = {}) {
  const definitionScope = normalizedDefinitionScope(overrides);
  return {
    ...clone(overrides),
    schemaVersion: AURA_INSTANCE_SCHEMA_VERSION,
    id: overrides.id ?? createId("aura-instance"),
    definitionId: String(overrides.definitionId ?? overrides.definitionSnapshot?.id ?? ""),
    definitionName: String(overrides.definitionName ?? overrides.definitionSnapshot?.name ?? ""),
    definitionScope,
    definitionSnapshot: definitionScope === "actor" && overrides.definitionSnapshot
      ? clone(overrides.definitionSnapshot)
      : null,
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
  resolved.definitionScope = instance.definitionScope ?? "library";
  return resolved;
}
