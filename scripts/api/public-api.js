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
  const actorAuras = new ActorAuraService({ library: repository });
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

    instances: Object.freeze({
      list: (actor) => actorAuras.list(actor),
      assign: (actor, definitionId, options = {}) => actorAuras.assign(actor, definitionId, options),
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
