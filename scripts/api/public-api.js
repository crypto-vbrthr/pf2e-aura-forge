import {
  API_VERSION,
  AURA_SCHEMA_VERSION,
  AURA_INSTANCE_SCHEMA_VERSION,
  MODULE_ID,
  MODULE_VERSION
} from "../constants.js";
import { createAuraDefinition, cloneAuraDefinition } from "../aura/aura-definition.js";
import { migrateAuraDefinition } from "../aura/aura-migrations.js";
import { validateAuraDefinition } from "../aura/aura-validator.js";
import { createFoundryAuraRepository } from "../aura/foundry-aura-repository.js";
import { auraEngineCore } from "../engine/aura-engine-core.js";
import { ActorAuraService } from "../actor/actor-aura-service.js";
import { getEffectForgeApi } from "../integration/effect-forge-bridge.js";
import { AuraRuntimeEngine } from "../runtime/aura-runtime-engine.js";
import { createAuraEditorUiApi } from "../ui/aura-editor.js";

let runtimeEngine = null;

export function getAuraRuntimeEngine() {
  return runtimeEngine;
}

export function initializePublicApi({ openAuraForge }) {
  const module = game.modules.get(MODULE_ID);
  if (!module) throw new Error(`Module ${MODULE_ID} is unavailable.`);
  const repository = createFoundryAuraRepository();
  const actorAuras = new ActorAuraService({ library: repository, gameRef: game });
  const validateForStorage = (definition) => {
    const normalized = createAuraDefinition(definition);
    const report = validateAuraDefinition(normalized, { effectApi: getEffectForgeApi()?.effects ?? null });
    if (!report.valid) {
      const error = new Error(report.errors.map((entry) => entry.message).join("; ") || "Aura definition is invalid.");
      error.name = "AuraDefinitionValidationError";
      error.code = "AURA_DEFINITION_INVALID";
      error.validation = report;
      throw error;
    }
    return normalized;
  };
  runtimeEngine = new AuraRuntimeEngine({
    library: repository,
    actorAuras,
    effectApi: getEffectForgeApi(),
    gameRef: game
  });

  const api = Object.freeze({
    version: API_VERSION,
    moduleVersion: MODULE_VERSION,
    schemaVersion: AURA_SCHEMA_VERSION,
    instanceSchemaVersion: AURA_INSTANCE_SCHEMA_VERSION,

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
      upsert: (definition) => repository.upsert(validateForStorage(definition)),
      remove: (id) => repository.remove(id),
      duplicate: (id, options = {}) => repository.duplicate(id, options)
    }),

    instances: Object.freeze({
      list: (actor) => actorAuras.list(actor),
      assign: (actor, definitionId, options = {}) => actorAuras.assign(actor, definitionId, options),
      assignDefinition: (actor, definition, options = {}) => actorAuras.assignDefinition(actor, validateForStorage(definition), options),
      updateDefinition: (actor, instanceId, definition) => actorAuras.updateDefinition(actor, instanceId, validateForStorage(definition)),
      remove: (actor, instanceId) => actorAuras.remove(actor, instanceId),
      setEnabled: (actor, instanceId, enabled) => actorAuras.setEnabled(actor, instanceId, enabled),
      setRadiusOverride: (actor, instanceId, value) => actorAuras.setRadiusOverride(actor, instanceId, value),
      resolve: (actor, instanceId) => actorAuras.resolve(actor, instanceId),
      assignmentsForDefinition: (definitionId) => actorAuras.assignmentsForDefinition(definitionId, game.actors?.contents ?? []),
      reconcileActor: (actor) => actorAuras.reconcileActor(actor),
      reconcileAll: () => actorAuras.reconcileAll(game.actors?.contents ?? []),
      syncDefinition: (definitionId) => actorAuras.syncDefinition(definitionId, game.actors?.contents ?? [])
    }),

    engine: Object.freeze({
      planPresence: (options) => auraEngineCore.planPresence(options),
      planPresenceRuntime: (options) => auraEngineCore.planPresenceRuntime(options),
      planPresenceLegacy: (options) => auraEngineCore.planPresenceLegacy(options),
      reconcileScene: (scene = globalThis.canvas?.scene, options = {}) => runtimeEngine.reconcileScene(scene, options),
      deactivateScene: (scene = globalThis.canvas?.scene) => runtimeEngine.deactivateScene(scene),
      status: () => runtimeEngine.status()
    }),

    ui: Object.freeze({
      openAuraForge,
      auraEditor: createAuraEditorUiApi()
    })
  });

  module.api = api;
  return api;
}
