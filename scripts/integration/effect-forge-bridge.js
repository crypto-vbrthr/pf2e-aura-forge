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

export function getEffectForgeApi({ gameRef = globalThis.game } = {}) {
  return gameRef?.modules?.get?.(EFFECT_FORGE_MODULE_ID)?.api ?? null;
}

export function assertEffectForgeApi(api) {
  if (!api) {
    throw new EffectForgeIntegrationError("PF2E Critical Forge API is unavailable.", "EFFECT_FORGE_API_MISSING");
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
