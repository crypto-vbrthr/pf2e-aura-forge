import { AURA_SCHEMA_VERSION } from "../constants.js";
import { createAuraDefinition } from "./aura-definition.js";

function clone(value) {
  return value == null ? value : structuredClone(value);
}

export class AuraMigrationError extends Error {
  constructor(message, code = "AURA_MIGRATION_FAILED") {
    super(message);
    this.name = "AuraMigrationError";
    this.code = code;
  }
}

function migrateV0ToV1(source) {
  const legacy = clone(source ?? {});
  const definition = createAuraDefinition({
    ...legacy,
    radius: legacy.radius ?? legacy.distance ?? 15,
    presenceEffects: legacy.presenceEffects ?? legacy.continuousEffects ?? [],
    triggers: legacy.triggers ?? legacy.eventEffects ?? []
  });
  delete definition.distance;
  delete definition.continuousEffects;
  delete definition.eventEffects;
  definition.schemaVersion = 1;
  return definition;
}

export function migrateAuraDefinition(source) {
  if (!source || typeof source !== "object" || Array.isArray(source)) {
    throw new AuraMigrationError("Aura definition must be an object.", "AURA_OBJECT_REQUIRED");
  }

  const rawVersion = source.schemaVersion;
  const fromVersion = rawVersion == null ? 0 : Number(rawVersion);
  if (!Number.isInteger(fromVersion) || fromVersion < 0) {
    throw new AuraMigrationError("Aura schema version is invalid.", "AURA_SCHEMA_VERSION_INVALID");
  }
  if (fromVersion > AURA_SCHEMA_VERSION) {
    throw new AuraMigrationError(
      `Aura schema version ${fromVersion} is newer than supported version ${AURA_SCHEMA_VERSION}.`,
      "AURA_SCHEMA_VERSION_FUTURE"
    );
  }

  let definition = clone(source);
  const steps = [];
  if (fromVersion === 0) {
    definition = migrateV0ToV1(definition);
    steps.push("0->1");
  } else {
    definition = createAuraDefinition(definition);
  }

  return {
    definition,
    fromVersion,
    toVersion: AURA_SCHEMA_VERSION,
    migrated: fromVersion !== AURA_SCHEMA_VERSION,
    steps,
    warnings: []
  };
}
