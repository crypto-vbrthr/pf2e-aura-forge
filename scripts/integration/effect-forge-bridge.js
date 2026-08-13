import {
  EFFECT_FORGE_MODULE_ID,
  REQUIRED_EFFECT_API_VERSION
} from "../constants.js";

export class EffectForgeIntegrationError extends Error {
  constructor(message, code) {
    super(message);
    this.name = "EffectForgeIntegrationError";
    this.code = code;
  }
}

function parseApiVersion(value) {
  const match = String(value ?? "").trim().match(/^(\d+)\.(\d+)\.(\d+)$/);
  if (!match) return null;
  return match.slice(1).map(Number);
}

export function isEffectApiVersionAtLeast(value, minimum = REQUIRED_EFFECT_API_VERSION) {
  const current = parseApiVersion(value);
  const required = parseApiVersion(minimum);
  if (!current || !required) return false;
  for (let index = 0; index < 3; index += 1) {
    if (current[index] > required[index]) return true;
    if (current[index] < required[index]) return false;
  }
  return true;
}

export function getEffectForgeApi({ gameRef = globalThis.game } = {}) {
  return gameRef?.modules?.get?.(EFFECT_FORGE_MODULE_ID)?.api ?? null;
}

export function assertEffectForgeApi(api) {
  if (!api) {
    throw new EffectForgeIntegrationError("PF2E Critical Forge API is unavailable.", "EFFECT_FORGE_API_MISSING");
  }
  if (!isEffectApiVersionAtLeast(api.version)) {
    throw new EffectForgeIntegrationError(
      `PF2E Critical Forge Effect API ${REQUIRED_EFFECT_API_VERSION} or newer is required.`,
      "EFFECT_API_VERSION_UNSUPPORTED"
    );
  }
  const editor = api.ui?.effectEditor;
  if (typeof editor?.createSession !== "function" || typeof editor?.create !== "function") {
    throw new EffectForgeIntegrationError("Embedded Effect Editor API is unavailable.", "EFFECT_EDITOR_API_MISSING");
  }
  if (typeof api.effects?.validate !== "function") {
    throw new EffectForgeIntegrationError("Effect validation API is unavailable.", "EFFECT_VALIDATION_API_MISSING");
  }
  if (typeof api.effects?.apply !== "function") {
    throw new EffectForgeIntegrationError("Effect application API is unavailable.", "EFFECT_APPLICATION_API_MISSING");
  }
  if (typeof api.effects?.execute !== "function") {
    throw new EffectForgeIntegrationError("Instant Effect execution API is unavailable.", "EFFECT_EXECUTION_API_MISSING");
  }
  if (typeof api.builders?.effect !== "function") {
    throw new EffectForgeIntegrationError("Effect Builder API is unavailable.", "EFFECT_BUILDER_API_MISSING");
  }
  return api;
}

export function describeEffectForgeCompatibility(api) {
  if (!api) return { compatible: false, reason: "missing", requiredApiVersion: REQUIRED_EFFECT_API_VERSION };
  try {
    assertEffectForgeApi(api);
    return {
      compatible: true,
      apiVersion: api.version ?? null,
      schemaVersion: api.schemaVersion ?? null,
      requiredApiVersion: REQUIRED_EFFECT_API_VERSION
    };
  } catch (error) {
    return {
      compatible: false,
      reason: error.code ?? "incompatible",
      apiVersion: api.version ?? null,
      requiredApiVersion: REQUIRED_EFFECT_API_VERSION
    };
  }
}

export function createDefaultEmbeddedEffect(api, {
  id,
  name,
  duration = { value: -1, unit: "unlimited", expiry: null }
} = {}) {
  assertEffectForgeApi(api);
  const builder = api.builders.effect()
    .setId(id ?? null)
    .setName(name ?? "")
    .setDuration(duration.value, duration.unit, duration.expiry)
    .setMetadata({
      originModule: "pf2e-aura-forge",
      originFeature: "aura-effect"
    });
  return builder.build();
}
