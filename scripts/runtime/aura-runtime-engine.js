import { MODULE_ID } from "../constants.js";
import { matchesAuraTarget } from "../engine/target-filter.js";
import { repairMalformedPhysicalDescriptions } from "./actor-data-guard.js";
import { isRuntimeCoordinator } from "./runtime-coordinator.js";
import { auraContainsToken } from "./spatial-service.js";
import { createRuntimeTargetContext } from "./runtime-target-context.js";
import { emitterRuntimeKey, planOccupancyTransitions } from "./runtime-transitions.js";
import { AuraSaveResolutionService } from "./save-resolution-service.js";
import { AuraImmunityService } from "./immunity-service.js";
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

function sameUser(a, b) {
  return Boolean(a && b && String(a.id ?? a._id ?? "") !== ""
    && String(a.id ?? a._id) === String(b.id ?? b._id));
}

function canUpdateActor(actor, gameRef) {
  const user = gameRef?.user;
  if (!user || !actor) return false;
  if (actor.primaryUpdater) return sameUser(actor.primaryUpdater, user);
  // If PF2e cannot provide a primaryUpdater, fall back to the single Aura
  // Forge runtime coordinator. This avoids two connected clients racing to
  // create the same presence Item.
  if (!isRuntimeCoordinator(gameRef)) return false;
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
    this.immunities = new AuraImmunityService({ gameRef });
    this.socketService = null;
    this.occupancy = new Map();
    this.processedCombatEvents = new Set();
    this.reconcileQueues = new Map();
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
        if (this.immunities.blocksPresence(target.actor, emitter)) continue;
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

  async #cleanupExpiredImmunities(scene) {
    let removed = 0;
    const errors = [];
    for (const actor of uniqueActors(scene, this.gameRef)) {
      if (!canUpdateActor(actor, this.gameRef)) continue;
      try {
        removed += await this.immunities.cleanupExpired(actor);
      } catch (error) {
        errors.push({ phase: "immunity-cleanup", actorUuid: actor?.uuid ?? actor?.id ?? null, error });
      }
    }
    return { removed, errors };
  }

  async #reconcilePresencePhase(scene, { emitters = null, targetsByEmitter = null } = {}) {
    const resolvedEmitters = emitters ?? await this.#emitters(scene);
    const cleanup = await this.#cleanupExpiredImmunities(scene);
    const desired = new Map();
    for (const emitter of resolvedEmitters) {
      const targets = targetsByEmitter?.get?.(emitter.key) ?? this.#currentTargets(emitter);
      this.#desiredPresence(emitter, targets, desired);
    }
    const presencePlan = this.#planPresence(scene, desired);
    const presenceRemove = await this.#removePresence(presencePlan);
    const presenceAdd = await this.#addPresence(presencePlan, presenceRemove.failedRemoveKeys);
    return {
      desired: presencePlan.desired,
      applied: presenceAdd.applied,
      removed: presenceRemove.removed,
      errors: [...cleanup.errors, ...presenceRemove.errors, ...presenceAdd.errors],
      expiredImmunitiesRemoved: cleanup.removed
    };
  }

  async #applyTriggerOutcome(emitter, trigger, targetToken, event, degree) {
    const targetActor = targetToken?.actor;
    const effect = trigger.outcomes?.[degree] ?? null;
    if (!targetActor || !effect) return 0;
    await repairMalformedPhysicalDescriptions(targetActor);
    await this.effectApi.effects.apply(prepareTriggerEffect(effect, event), targetToken, {
      // Event outcomes are the one-shot boundary owned by Aura Forge. Critical
      // Forge applies persistent components and executes instant damage/death
      // exactly once for this already-claimed aura occurrence. Passing the
      // exact Token preserves token-specific PF2e damage application when one
      // Actor has multiple active tokens.
      executeInstant: true,
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

  #immunityApplies(trigger, degree) {
    return Boolean(
      trigger?.immunity?.enabled
      && Array.isArray(trigger.immunity.applyOn)
      && trigger.immunity.applyOn.includes(degree)
    );
  }

  async #applyTriggerImmunity(emitter, trigger, targetActor, degree) {
    if (!this.#immunityApplies(trigger, degree)) return { applied: 0, error: null };
    if (!canUpdateActor(targetActor, this.gameRef)) return { applied: 0, error: null };
    try {
      const existing = this.immunities.active(targetActor, emitter, trigger);
      if (existing.length > 0) return { applied: 0, error: null };
      const created = await this.immunities.apply(targetActor, emitter, trigger);
      return { applied: created.length > 0 ? 1 : 0, error: null };
    } catch (error) {
      return { applied: 0, error };
    }
  }

  async #resolveMandatorySave(request) {
    let initial;
    try {
      initial = this.socketService
        ? await this.socketService.resolveSave(request)
        : await this.saveResolution.roll(request);
    } catch (error) {
      initial = { status: "error", degree: null, error };
    }

    if (initial?.status === "resolved") {
      return { result: initial, fallbackUsed: false, initialStatus: "resolved", initialError: null };
    }
    if (initial?.status === "not-required") {
      return { result: initial, fallbackUsed: false, initialStatus: "not-required", initialError: null };
    }

    // A save attached to an Aura trigger is mandatory game state. Closing the
    // dialog, losing the remote resolver, or timing out must not turn the save
    // into an opt-out. The Actor's single runtime writer resolves one native
    // PF2e no-dialog fallback and continues from that degree of success.
    let fallback;
    try {
      fallback = await this.saveResolution.rollForced(request, { skipDialog: true });
    } catch (error) {
      fallback = { status: "error", degree: null, error };
    }
    return {
      result: fallback,
      fallbackUsed: true,
      initialStatus: initial?.status ?? "error",
      initialError: initial?.error ?? null
    };
  }

  async #runTrigger(emitter, targetToken, event) {
    const targetActor = targetToken?.actor;
    if (!targetActor) {
      return {
        applied: 0,
        deferred: 0,
        savesResolved: 0,
        savesCancelled: 0,
        savesFallback: 0,
        saveFallbacks: [],
        saveErrors: [],
        immunityApplied: 0,
        immunitySkipped: 0,
        immunityErrors: []
      };
    }

    // Runtime mutations are owned by exactly one client per target Actor.
    // With an active GM this is normally the GM (PF2e primaryUpdater); without
    // one it naturally falls back to the assigned/owning player. This avoids
    // duplicate side effects while still allowing no-GM sessions to function.
    if (!canUpdateActor(targetActor, this.gameRef)) {
      return {
        applied: 0,
        deferred: 0,
        savesResolved: 0,
        savesCancelled: 0,
        savesFallback: 0,
        saveFallbacks: [],
        saveErrors: [],
        immunityApplied: 0,
        immunitySkipped: 0,
        immunityErrors: []
      };
    }

    let applied = 0;
    let deferred = 0;
    let savesResolved = 0;
    let savesCancelled = 0;
    let savesFallback = 0;
    let immunityApplied = 0;
    let immunitySkipped = 0;
    const saveFallbacks = [];
    const saveErrors = [];
    const immunityErrors = [];

    try { await this.immunities.cleanupExpired(targetActor); }
    catch (error) { immunityErrors.push({ triggerId: null, status: "cleanup-error", error }); }

    const matchingTriggers = (emitter.aura.triggers ?? []).filter((trigger) => trigger?.event === event);
    // Immunity that already exists when this event starts blocks the event. An
    // immunity granted by one trigger during this same event does not cancel
    // sibling triggers that are part of the same aura occurrence; it takes
    // effect for subsequent aura events and for the post-event Presence pass.
    const blockedAtEventStart = this.immunities.hasForEmitter(targetActor, emitter);
    if (blockedAtEventStart) {
      immunitySkipped += matchingTriggers.length;
      return {
        applied,
        deferred,
        savesResolved,
        savesCancelled,
        savesFallback,
        saveFallbacks,
        saveErrors,
        immunityApplied,
        immunitySkipped,
        immunityErrors
      };
    }

    for (const trigger of matchingTriggers) {

      if (trigger.save?.enabled) {
        const request = {
          targetActor,
          targetToken,
          sourceActor: emitter.sourceActor,
          sourceToken: emitter.sourceToken,
          trigger,
          aura: emitter.aura
        };
        const resolution = await this.#resolveMandatorySave(request);
        const result = resolution.result;
        if (resolution.fallbackUsed) {
          savesFallback += 1;
          saveFallbacks.push({
            triggerId: trigger.id,
            initialStatus: resolution.initialStatus,
            resolved: result?.status === "resolved"
          });
          if (resolution.initialStatus === "cancelled") savesCancelled += 1;
        }

        if (result?.status === "resolved") {
          savesResolved += 1;
          try {
            applied += await this.#applyTriggerOutcome(emitter, trigger, targetToken, event, result.degree);
          } catch (error) {
            saveErrors.push({ triggerId: trigger.id, status: "outcome-error", error });
          }
          const immunity = await this.#applyTriggerImmunity(emitter, trigger, targetActor, result.degree);
          immunityApplied += immunity.applied;
          if (immunity.error) immunityErrors.push({ triggerId: trigger.id, status: "apply-error", error: immunity.error });
        } else if (result?.status === "cancelled") {
          savesCancelled += 1;
          saveErrors.push({ triggerId: trigger.id, status: "fallback-cancelled", saveType: trigger.save.type });
        } else if (!["not-resolver", "not-required"].includes(result?.status)) {
          saveErrors.push({ triggerId: trigger.id, status: result?.status ?? "unavailable", saveType: trigger.save.type });
        }
        continue;
      }

      // Without a saving throw, the success slot is the canonical direct outcome.
      try {
        applied += await this.#applyTriggerOutcome(emitter, trigger, targetToken, event, "success");
      } catch (error) {
        saveErrors.push({ triggerId: trigger.id, status: "outcome-error", error });
      }
      const immunity = await this.#applyTriggerImmunity(emitter, trigger, targetActor, "success");
      immunityApplied += immunity.applied;
      if (immunity.error) immunityErrors.push({ triggerId: trigger.id, status: "apply-error", error: immunity.error });
    }

    return {
      applied,
      deferred,
      savesResolved,
      savesCancelled,
      savesFallback,
      saveFallbacks,
      saveErrors,
      immunityApplied,
      immunitySkipped,
      immunityErrors
    };
  }

  async #processTransitions(scene, emitters, currentByEmitter, { seed = false, fireEvents = true } = {}) {
    let entered = 0;
    let left = 0;
    let triggerEffects = 0;
    let deferredSaves = 0;
    let savesResolved = 0;
    let savesCancelled = 0;
    let savesFallback = 0;
    let immunityApplied = 0;
    let immunitySkipped = 0;
    const saveFallbacks = [];
    const saveErrors = [];
    const immunityErrors = [];
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

      for (const tokenId of transitions.entered) {
        const token = tokenById(scene, tokenId);
        if (!token?.actor || !canUpdateActor(token.actor, this.gameRef)) continue;
        const result = await this.#runTrigger(emitter, token, "enter");
        triggerEffects += result.applied;
        deferredSaves += result.deferred;
        savesResolved += result.savesResolved ?? 0;
        savesCancelled += result.savesCancelled ?? 0;
        savesFallback += result.savesFallback ?? 0;
        saveFallbacks.push(...(result.saveFallbacks ?? []));
        saveErrors.push(...(result.saveErrors ?? []));
        immunityApplied += result.immunityApplied ?? 0;
        immunitySkipped += result.immunitySkipped ?? 0;
        immunityErrors.push(...(result.immunityErrors ?? []));
      }
      for (const tokenId of transitions.left) {
        const token = tokenById(scene, tokenId);
        if (!token?.actor || !canUpdateActor(token.actor, this.gameRef)) continue;
        const result = await this.#runTrigger(emitter, token, "leave");
        triggerEffects += result.applied;
        deferredSaves += result.deferred;
        savesResolved += result.savesResolved ?? 0;
        savesCancelled += result.savesCancelled ?? 0;
        savesFallback += result.savesFallback ?? 0;
        saveFallbacks.push(...(result.saveFallbacks ?? []));
        saveErrors.push(...(result.saveErrors ?? []));
        immunityApplied += result.immunityApplied ?? 0;
        immunitySkipped += result.immunitySkipped ?? 0;
        immunityErrors.push(...(result.immunityErrors ?? []));
      }
    }

    // An emitter that vanished (deleted token, disabled assignment, deleted
    // definition) is forgotten without synthesizing a leave event.
    for (const key of [...this.occupancy.keys()]) {
      if (key.startsWith(`${scene.id}::`) && !activeEmitterKeys.has(key)) this.occupancy.delete(key);
    }

    return {
      entered,
      left,
      triggerEffects,
      deferredSaves,
      savesResolved,
      savesCancelled,
      savesFallback,
      saveFallbacks,
      saveErrors,
      immunityApplied,
      immunitySkipped,
      immunityErrors
    };
  }

  #tokenMatchesEmitter(emitter, targetToken) {
    if (!targetToken?.actor) return false;
    const context = createRuntimeTargetContext(emitter.sourceToken, targetToken);
    return matchesAuraTarget(emitter.aura, context)
      && auraContainsToken(emitter.sourceToken, targetToken, emitter.aura.radius, { scene: emitter.scene });
  }

  #combatTokenId(combat, state = {}) {
    if (state?.tokenId) return state.tokenId;
    if (state?.combatantId) {
      const combatant = combat?.combatants?.get?.(state.combatantId)
        ?? combat?.combatants?.contents?.find?.((entry) => entry.id === state.combatantId);
      const id = combatant?.tokenId ?? combatant?.token?.id ?? combatant?.token?.document?.id;
      if (id) return id;
    }
    const turn = Number(state?.turn);
    if (Number.isInteger(turn) && turn >= 0) {
      const turns = combat?.turns?.contents ?? combat?.turns ?? [];
      const combatant = turns?.[turn];
      return combatant?.tokenId ?? combatant?.token?.id ?? combatant?.token?.document?.id ?? null;
    }
    return null;
  }

  #claimCombatEvent(combat, event, state = {}) {
    // Combatant identity is more stable than a turn index. Initiative order can
    // change during a round, which would otherwise make the same combatant look
    // like a new event merely because its array position changed.
    const subject = state?.tokenId ?? state?.combatantId ?? `turn-${state?.turn ?? ""}`;
    const key = [combat?.id ?? "combat", event, state?.round ?? "", subject]
      .map((value) => String(value ?? ""))
      .join("::");
    if (this.processedCombatEvents.has(key)) return false;
    this.processedCombatEvents.add(key);
    if (this.processedCombatEvents.size > 200) {
      const oldest = this.processedCombatEvents.values().next().value;
      if (oldest) this.processedCombatEvents.delete(oldest);
    }
    return true;
  }

  resetCombat(combatId) {
    const prefix = `${String(combatId ?? "combat")}::`;
    for (const key of [...this.processedCombatEvents]) {
      if (key.startsWith(prefix)) this.processedCombatEvents.delete(key);
    }
  }

  async #runTurnEvent(scene, tokenId, event) {
    const report = {
      event,
      tokenId: tokenId ?? null,
      emittersMatched: 0,
      triggerEffects: 0,
      savesResolved: 0,
      savesCancelled: 0,
      savesFallback: 0,
      saveFallbacks: [],
      saveErrors: [],
      immunityApplied: 0,
      immunitySkipped: 0,
      immunityErrors: []
    };
    if (!scene?.id || !tokenId) return report;
    const targetToken = tokenById(scene, tokenId);
    if (!targetToken?.actor || !canUpdateActor(targetToken.actor, this.gameRef)) return report;

    const emitters = await this.#emitters(scene);
    for (const emitter of emitters) {
      if (!this.#tokenMatchesEmitter(emitter, targetToken)) continue;
      report.emittersMatched += 1;
      const result = await this.#runTrigger(emitter, targetToken, event);
      report.triggerEffects += result.applied ?? 0;
      report.savesResolved += result.savesResolved ?? 0;
      report.savesCancelled += result.savesCancelled ?? 0;
      report.savesFallback += result.savesFallback ?? 0;
      report.saveFallbacks.push(...(result.saveFallbacks ?? []));
      report.saveErrors.push(...(result.saveErrors ?? []));
      report.immunityApplied += result.immunityApplied ?? 0;
      report.immunitySkipped += result.immunitySkipped ?? 0;
      report.immunityErrors.push(...(result.immunityErrors ?? []));
    }

    // A turn-bound outcome can grant or refresh immunity after a Presence
    // Effect already exists. Reconcile continuous state only after all event
    // side effects have completed so newly granted immunity takes effect
    // immediately, and expired immunity can restore Presence while the target
    // is still inside the aura.
    report.presence = await this.reconcilePresence(scene);
    return report;
  }

  async handleCombatTurnChange(combat, prior = {}, current = {}) {
    const scene = combat?.scene ?? this.gameRef?.scenes?.get?.(combat?.scene?.id ?? combat?.sceneId) ?? globalThis.canvas?.scene ?? null;
    if (!scene?.id) return null;

    const priorRound = Number(prior?.round ?? 0);
    const currentRound = Number(current?.round ?? 0);
    const priorTurn = Number(prior?.turn ?? -1);
    const currentTurn = Number(current?.turn ?? -1);
    const forward = currentRound > priorRound || (currentRound === priorRound && currentTurn > priorTurn);
    if (!forward) {
      return { sceneId: scene.id, forward: false, turnEnd: null, turnStart: null };
    }

    const priorTokenId = this.#combatTokenId(combat, prior);
    const currentTokenId = this.#combatTokenId(combat, current);
    const priorState = { ...prior, tokenId: priorTokenId };
    const currentState = { ...current, tokenId: currentTokenId };
    const turnEnd = this.#claimCombatEvent(combat, "turnEnd", priorState)
      ? await this.#runTurnEvent(scene, priorTokenId, "turnEnd")
      : null;
    const turnStart = this.#claimCombatEvent(combat, "turnStart", currentState)
      ? await this.#runTurnEvent(scene, currentTokenId, "turnStart")
      : null;
    const report = { sceneId: scene.id, forward: true, turnEnd, turnStart };
    this.lastReport = { ...(this.lastReport ?? {}), combatTurn: clone(report), timestamp: Date.now() };
    return report;
  }

  async handleCombatStart(combat, updateData = {}) {
    const scene = combat?.scene ?? this.gameRef?.scenes?.get?.(combat?.scene?.id ?? combat?.sceneId) ?? globalThis.canvas?.scene ?? null;
    if (!scene?.id) return null;
    // A Combat document can be reset and started again without changing its ID.
    // Clear claims from the previous run so round-one events are eligible again.
    this.resetCombat(combat?.id);
    const turnIndex = Number(updateData?.turn ?? combat?.turn ?? 0);
    const turns = combat?.turns?.contents ?? combat?.turns ?? [];
    const combatant = turns?.[turnIndex] ?? combat?.combatant ?? null;
    const tokenId = combatant?.tokenId ?? combatant?.token?.id ?? combatant?.token?.document?.id ?? null;
    const state = { round: Number(updateData?.round ?? combat?.round ?? 1), turn: turnIndex, tokenId };
    const turnStart = this.#claimCombatEvent(combat, "turnStart", state)
      ? await this.#runTurnEvent(scene, tokenId, "turnStart")
      : null;
    const report = { sceneId: scene.id, turnStart };
    this.lastReport = { ...(this.lastReport ?? {}), combatStart: clone(report), timestamp: Date.now() };
    return report;
  }

  async #reconcileSceneNow(scene, { seed = false, fireEvents = true } = {}) {
    if (!scene?.id) return null;
    const firstRun = !this.initializedScenes.has(scene.id);
    const shouldSeed = seed || firstRun;
    const emitters = await this.#emitters(scene);
    const targetsByEmitter = new Map();
    const currentByEmitter = new Map();

    for (const emitter of emitters) {
      const targets = this.#currentTargets(emitter);
      targetsByEmitter.set(emitter.key, targets);
      currentByEmitter.set(emitter.key, new Set(targets.map((entry) => entry.token.id)));
    }

    // Discrete events run first. This matters when an enter/save grants
    // temporary immunity which is configured to suppress the continuous
    // presence effect as well.
    const transitions = await this.#processTransitions(scene, emitters, currentByEmitter, {
      seed: shouldSeed,
      fireEvents
    });

    const presence = await this.#reconcilePresencePhase(scene, { emitters, targetsByEmitter });
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

  async #queueSceneOperation(scene, operation) {
    if (!scene?.id) return null;
    const sceneId = scene.id;
    const previous = this.reconcileQueues.get(sceneId) ?? Promise.resolve();
    const run = previous
      .catch(() => undefined)
      .then(operation);
    this.reconcileQueues.set(sceneId, run);
    try {
      return await run;
    } finally {
      if (this.reconcileQueues.get(sceneId) === run) this.reconcileQueues.delete(sceneId);
    }
  }

  async reconcileScene(scene, options = {}) {
    return this.#queueSceneOperation(scene, () => this.#reconcileSceneNow(scene, options));
  }

  async reconcilePresence(scene) {
    return this.#queueSceneOperation(scene, () => this.#reconcilePresencePhase(scene));
  }

  async deactivateScene(scene) {
    if (!scene?.id) return { removed: 0 };
    const pending = this.reconcileQueues.get(scene.id);
    if (pending) {
      try { await pending; } catch { /* cleanup still proceeds */ }
    }
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
