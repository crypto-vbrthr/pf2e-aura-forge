import { MODULE_ID } from "../constants.js";
import { matchesAuraTarget } from "../engine/target-filter.js";
import { repairMalformedPhysicalDescriptions } from "./actor-data-guard.js";
import { isRuntimeCoordinator } from "./runtime-coordinator.js";
import { auraContainsToken } from "./spatial-service.js";
import { createRuntimeTargetContext } from "./runtime-target-context.js";
import { emitterRuntimeKey, planOccupancyTransitions } from "./runtime-transitions.js";
import { AuraSaveResolutionService } from "./save-resolution-service.js";
import {
  buildRuntimePresenceKey,
  collectPresenceBindings,
  effectFingerprint,
  PresenceBindingService
} from "./presence-binding-service.js";

function clone(value) {
  if (value == null) return value;
  const deepClone = globalThis.foundry?.utils?.deepClone;
  return typeof deepClone === "function" ? deepClone(value) : structuredClone(value);
}

function sceneTokens(scene) {
  const tokens = scene?.tokens;
  if (!tokens) return [];
  if (Array.isArray(tokens)) return tokens;
  if (Array.isArray(tokens.contents)) return tokens.contents;
  try { return Array.from(tokens); } catch { return []; }
}

function uniqueActors(scene, gameRef) {
  const byUuid = new Map();
  for (const actor of gameRef?.actors?.contents ?? []) {
    if (actor) byUuid.set(actor.uuid ?? actor.id, actor);
  }
  for (const token of sceneTokens(scene)) {
    const actor = token?.actor;
    if (actor) byUuid.set(actor.uuid ?? actor.id, actor);
  }
  return [...byUuid.values()];
}

function canUpdateActor(actor, gameRef) {
  const user = gameRef?.user;
  if (!user || !actor) return false;
  if (actor.primaryUpdater) return actor.primaryUpdater === user;
  if (typeof actor.canUserModify === "function") return actor.canUserModify(user, "update");
  return Boolean(user.isGM);
}

function tokenById(scene, id) {
  return scene?.tokens?.get?.(id) ?? sceneTokens(scene).find((token) => token.id === id) ?? null;
}

function prepareTriggerEffect(effect, event) {
  const prepared = clone(effect);
  if (!prepared) return null;
  prepared.metadata = {
    ...(prepared.metadata ?? {}),
    originModule: MODULE_ID,
    originFeature: `aura-trigger-${event}`
  };
  return prepared;
}

export class AuraRuntimeEngine {
  constructor({ library, actorAuras, effectApi, gameRef = globalThis.game } = {}) {
    this.library = library;
    this.actorAuras = actorAuras;
    this.effectApi = effectApi;
    this.gameRef = gameRef;
    this.presenceBindings = new PresenceBindingService({ effectApi });
    this.saveResolution = new AuraSaveResolutionService({ gameRef });
    this.socketService = null;
    this.occupancy = new Map();
    this.initializedScenes = new Set();
    this.lastReport = null;
  }

  setEffectApi(effectApi) {
    this.effectApi = effectApi;
    this.presenceBindings.effectApi = effectApi;
    return this;
  }

  setSocketService(socketService) {
    this.socketService = socketService ?? null;
    return this;
  }

  status() {
    return {
      initializedScenes: [...this.initializedScenes],
      emittersTracked: this.occupancy.size,
      lastReport: clone(this.lastReport)
    };
  }

  async #emitters(scene) {
    const emitters = [];
    for (const sourceToken of sceneTokens(scene)) {
      const sourceActor = sourceToken?.actor;
      if (!sourceActor || sourceToken.hidden) continue;
      for (const instance of this.actorAuras.list(sourceActor)) {
        if (!instance.enabled) continue;
        const report = await this.actorAuras.resolve(sourceActor, instance.id);
        const aura = report?.resolved;
        if (!aura?.enabled) continue;
        emitters.push({
          key: emitterRuntimeKey(scene.id, sourceToken.id, instance.id),
          scene,
          sourceToken,
          sourceActor,
          instance,
          aura
        });
      }
    }
    return emitters;
  }

  #currentTargets(emitter) {
    const matches = [];
    for (const targetToken of sceneTokens(emitter.scene)) {
      if (!targetToken?.actor) continue;
      const context = createRuntimeTargetContext(emitter.sourceToken, targetToken);
      if (!matchesAuraTarget(emitter.aura, context)) continue;
      if (!auraContainsToken(emitter.sourceToken, targetToken, emitter.aura.radius, { scene: emitter.scene })) continue;
      matches.push({ token: targetToken, actor: targetToken.actor, context });
    }
    return matches;
  }

  #desiredPresence(emitter, targets, desired) {
    for (const presence of emitter.aura.presenceEffects ?? []) {
      if (!presence?.effect) continue;
      const byActor = new Map();
      for (const target of targets) {
        const actorUuid = target.context.actorUuid;
        if (!actorUuid) continue;
        const entry = byActor.get(actorUuid) ?? { actor: target.actor, tokenIds: [] };
        entry.tokenIds.push(target.token.id);
        byActor.set(actorUuid, entry);
      }
      for (const [targetActorUuid, target] of byActor) {
        const key = buildRuntimePresenceKey({
          sceneId: emitter.scene.id,
          sourceTokenId: emitter.sourceToken.id,
          instanceId: emitter.instance.id,
          presenceEffectId: presence.id,
          targetActorUuid
        });
        desired.set(key, {
          key,
          sceneId: emitter.scene.id,
          auraId: emitter.aura.id,
          instanceId: emitter.instance.id,
          presenceEffectId: presence.id,
          sourceActorUuid: emitter.sourceActor.uuid ?? emitter.sourceActor.id,
          sourceTokenId: emitter.sourceToken.id,
          targetActorUuid,
          targetActor: target.actor,
          targetTokenIds: target.tokenIds,
          effect: presence.effect,
          effectFingerprint: effectFingerprint(presence.effect)
        });
      }
    }
  }

  #planPresence(scene, desired) {
    const actors = uniqueActors(scene, this.gameRef);
    const active = collectPresenceBindings(actors, { sceneId: scene.id });
    const remove = [];
    const add = [];

    for (const [key, group] of active) {
      const wanted = desired.get(key);
      if (!wanted || group.flag?.effectFingerprint !== wanted.effectFingerprint) remove.push(group);
    }
    for (const [key, wanted] of desired) {
      const group = active.get(key);
      if (!group || group.flag?.effectFingerprint !== wanted.effectFingerprint) add.push(wanted);
    }
    return { desired: desired.size, remove, add };
  }

  async #removePresence(plan) {
    let removed = 0;
    const errors = [];
    const failedRemoveKeys = new Set();
    for (const group of plan.remove) {
      if (!canUpdateActor(group.actor, this.gameRef)) continue;
      try {
        await this.presenceBindings.removeGroup(group);
        removed += 1;
      } catch (error) {
        failedRemoveKeys.add(group.key);
        errors.push({ phase: "presence-remove", key: group.key, error });
      }
    }
    return { removed, errors, failedRemoveKeys };
  }

  async #addPresence(plan, failedRemoveKeys = new Set()) {
    let applied = 0;
    const errors = [];
    for (const wanted of plan.add) {
      if (failedRemoveKeys.has(wanted.key)) continue;
      if (!canUpdateActor(wanted.targetActor, this.gameRef)) continue;
      try {
        await this.presenceBindings.apply(wanted.targetActor, wanted);
        applied += 1;
      } catch (error) {
        errors.push({ phase: "presence-apply", key: wanted.key, error });
      }
    }
    return { applied, errors };
  }

  async #applyTriggerOutcome(emitter, trigger, targetToken, event, degree) {
    const targetActor = targetToken?.actor;
    const effect = trigger.outcomes?.[degree] ?? null;
    if (!targetActor || !effect) return 0;
    await repairMalformedPhysicalDescriptions(targetActor);
    await this.effectApi.effects.apply(prepareTriggerEffect(effect, event), targetActor, {
      context: {
        source: "aura-trigger",
        auraId: emitter.aura.id,
        instanceId: emitter.instance.id,
        triggerId: trigger.id,
        event,
        degree,
        sourceActor: emitter.sourceActor,
        sourceToken: emitter.sourceToken,
        targetToken
      }
    });
    return 1;
  }

  async #runTrigger(emitter, targetToken, event) {
    const targetActor = targetToken?.actor;
    if (!targetActor) return { applied: 0, deferred: 0, savesResolved: 0, savesCancelled: 0, saveErrors: [] };
    let applied = 0;
    let deferred = 0;
    let savesResolved = 0;
    let savesCancelled = 0;
    const saveErrors = [];

    for (const trigger of emitter.aura.triggers ?? []) {
      if (trigger?.event !== event) continue;

      if (trigger.save?.enabled) {
        try {
          const request = {
            targetActor,
            targetToken,
            sourceActor: emitter.sourceActor,
            trigger,
            aura: emitter.aura
          };
          const result = this.socketService
            ? await this.socketService.resolveSave(request)
            : await this.saveResolution.roll(request);
          if (result.status === "resolved") {
            savesResolved += 1;
            applied += await this.#applyTriggerOutcome(emitter, trigger, targetToken, event, result.degree);
          } else if (result.status === "cancelled") {
            savesCancelled += 1;
          } else if (!["not-resolver", "not-required"].includes(result.status)) {
            saveErrors.push({ triggerId: trigger.id, status: result.status, saveType: trigger.save.type });
          }
        } catch (error) {
          saveErrors.push({ triggerId: trigger.id, status: "error", error });
        }
        continue;
      }

      if (!canUpdateActor(targetActor, this.gameRef)) continue;
      // Without a saving throw, the success slot is the canonical direct outcome.
      applied += await this.#applyTriggerOutcome(emitter, trigger, targetToken, event, "success");
    }
    return { applied, deferred, savesResolved, savesCancelled, saveErrors };
  }

  async #processTransitions(scene, emitters, currentByEmitter, { seed = false, fireEvents = true } = {}) {
    let entered = 0;
    let left = 0;
    let triggerEffects = 0;
    let deferredSaves = 0;
    let savesResolved = 0;
    let savesCancelled = 0;
    const saveErrors = [];
    const activeEmitterKeys = new Set(emitters.map((emitter) => emitter.key));

    for (const emitter of emitters) {
      const current = currentByEmitter.get(emitter.key) ?? new Set();
      const previous = this.occupancy.get(emitter.key);
      if (seed || !previous || !fireEvents) {
        this.occupancy.set(emitter.key, new Set(current));
        continue;
      }
      const transitions = planOccupancyTransitions(previous, current);
      entered += transitions.entered.length;
      left += transitions.left.length;
      // Commit occupancy before awaiting interactive saving-throw dialogs so a
      // second reconciliation cannot request the same transition twice.
      this.occupancy.set(emitter.key, new Set(current));

      // Exactly one client coordinates transition side effects. Remote player
      // save dialogs are explicitly routed over the module socket from there.
      if (!isRuntimeCoordinator(this.gameRef)) continue;

      for (const tokenId of transitions.entered) {
        const token = tokenById(scene, tokenId);
        if (!token) continue;
        const result = await this.#runTrigger(emitter, token, "enter");
        triggerEffects += result.applied;
        deferredSaves += result.deferred;
        savesResolved += result.savesResolved ?? 0;
        savesCancelled += result.savesCancelled ?? 0;
        saveErrors.push(...(result.saveErrors ?? []));
      }
      for (const tokenId of transitions.left) {
        const token = tokenById(scene, tokenId);
        if (!token) continue;
        const result = await this.#runTrigger(emitter, token, "leave");
        triggerEffects += result.applied;
        deferredSaves += result.deferred;
        savesResolved += result.savesResolved ?? 0;
        savesCancelled += result.savesCancelled ?? 0;
        saveErrors.push(...(result.saveErrors ?? []));
      }
    }

    // An emitter that vanished (deleted token, disabled assignment, deleted
    // definition) is forgotten without synthesizing a leave event.
    for (const key of [...this.occupancy.keys()]) {
      if (key.startsWith(`${scene.id}::`) && !activeEmitterKeys.has(key)) this.occupancy.delete(key);
    }

    return { entered, left, triggerEffects, deferredSaves, savesResolved, savesCancelled, saveErrors };
  }

  async reconcileScene(scene, { seed = false, fireEvents = true } = {}) {
    if (!scene?.id) return null;
    const firstRun = !this.initializedScenes.has(scene.id);
    const shouldSeed = seed || firstRun;
    const emitters = await this.#emitters(scene);
    const desired = new Map();
    const currentByEmitter = new Map();

    for (const emitter of emitters) {
      const targets = this.#currentTargets(emitter);
      currentByEmitter.set(emitter.key, new Set(targets.map((entry) => entry.token.id)));
      this.#desiredPresence(emitter, targets, desired);
    }

    const presencePlan = this.#planPresence(scene, desired);
    // Presence that is no longer valid is removed before leave triggers run.
    // Enter triggers (including interactive saves) run before new presence Items
    // are created, so a document-preparation problem in a target inventory cannot
    // suppress the transition itself.
    const presenceRemove = await this.#removePresence(presencePlan);
    const transitions = await this.#processTransitions(scene, emitters, currentByEmitter, {
      seed: shouldSeed,
      fireEvents
    });
    const presenceAdd = await this.#addPresence(presencePlan, presenceRemove.failedRemoveKeys);
    const presence = {
      desired: presencePlan.desired,
      applied: presenceAdd.applied,
      removed: presenceRemove.removed,
      errors: [...presenceRemove.errors, ...presenceAdd.errors]
    };
    this.initializedScenes.add(scene.id);
    this.lastReport = {
      sceneId: scene.id,
      emitters: emitters.length,
      presence,
      transitions,
      seeded: shouldSeed,
      timestamp: Date.now()
    };
    return clone(this.lastReport);
  }

  async deactivateScene(scene) {
    if (!scene?.id) return { removed: 0 };
    const actors = uniqueActors(scene, this.gameRef);
    const active = collectPresenceBindings(actors, { sceneId: scene.id });
    let removed = 0;
    for (const group of active.values()) {
      if (!canUpdateActor(group.actor, this.gameRef)) continue;
      await this.presenceBindings.removeGroup(group);
      removed += 1;
    }
    for (const key of [...this.occupancy.keys()]) {
      if (key.startsWith(`${scene.id}::`)) this.occupancy.delete(key);
    }
    this.initializedScenes.delete(scene.id);
    return { removed };
  }
}
