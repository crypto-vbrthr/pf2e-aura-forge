import {
  API_VERSION,
  AURA_SCHEMA_VERSION,
  MODULE_ID,
  MODULE_VERSION
} from "../constants.js";
import { createAuraDefinition, cloneAuraDefinition } from "../aura/aura-definition.js";
import { migrateAuraDefinition } from "../aura/aura-migrations.js";
import { validateAuraDefinition } from "../aura/aura-validator.js";
import { createFoundryAuraRepository } from "../aura/foundry-aura-repository.js";
import { auraEngineCore } from "../engine/aura-engine-core.js";
import { getEffectForgeApi } from "../integration/effect-forge-bridge.js";

export function initializePublicApi({ openAuraForge }) {
  const module = game.modules.get(MODULE_ID);
  if (!module) throw new Error(`Module ${MODULE_ID} is unavailable.`);
  const repository = createFoundryAuraRepository();

  const api = Object.freeze({
    version: API_VERSION,
    moduleVersion: MODULE_VERSION,
    schemaVersion: AURA_SCHEMA_VERSION,

    definitions: Object.freeze({
      create: (overrides = {}) => createAuraDefinition(overrides),
      clone: (definition, options = {}) => cloneAuraDefinition(definition, options),
      migrate: (definition) => migrateAuraDefinition(definition),
      validate: (definition) => validateAuraDefinition(definition, {
        effectApi: getEffectForgeApi()?.effects ?? null
      })
    }),

    library: Object.freeze({
      list: () => repository.list(),
      get: (id) => repository.get(id),
      upsert: (definition) => repository.upsert(definition),
      remove: (id) => repository.remove(id),
      duplicate: (id, options = {}) => repository.duplicate(id, options)
    }),

    engine: Object.freeze({
      planPresence: (options) => auraEngineCore.planPresence(options)
    }),

    ui: Object.freeze({
      openAuraForge
    })
  });

  module.api = api;
  return api;
}
