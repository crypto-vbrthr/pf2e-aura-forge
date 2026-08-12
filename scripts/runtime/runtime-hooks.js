import { MODULE_ID, SETTINGS } from "../constants.js";
import { IMMUNITY_FLAG, immunityFlag } from "./immunity-service.js";

const RECONCILE_DELAY_MS = 60;

function currentScene(canvasRef = globalThis.canvas) {
  return canvasRef?.scene ?? null;
}

function isMovementChange(changes = {}) {
  return ["x", "y", "elevation"].some((key) => Object.prototype.hasOwnProperty.call(changes ?? {}, key));
}

function collectionContents(collection) {
  if (!collection) return [];
  if (Array.isArray(collection)) return collection;
  if (Array.isArray(collection.contents)) return collection.contents;
  try { return Array.from(collection); } catch { return []; }
}

function combatState(combat, overrides = {}) {
  const round = overrides.round ?? combat?.round ?? 0;
  const turn = overrides.turn ?? combat?.turn ?? null;
  const turns = combat?.turns?.contents ?? combat?.turns ?? [];
  const index = Number(turn);
  const combatant = overrides.combatantId
    ? combat?.combatants?.get?.(overrides.combatantId) ?? collectionContents(combat?.combatants).find((entry) => entry.id === overrides.combatantId)
    : (Number.isInteger(index) && index >= 0 ? turns?.[index] : combat?.combatant);
  return {
    round: Number(round) || 0,
    turn: turn == null ? null : Number(turn),
    combatantId: overrides.combatantId ?? combatant?.id ?? null,
    tokenId: overrides.tokenId ?? combatant?.tokenId ?? combatant?.token?.id ?? combatant?.token?.document?.id ?? null
  };
}

function sameCombatState(a, b) {
  return Boolean(a && b
    && Number(a.round ?? 0) === Number(b.round ?? 0)
    && (a.turn ?? null) === (b.turn ?? null)
    && String(a.tokenId ?? "") === String(b.tokenId ?? ""));
}

function actorHasTokenOnScene(actor, scene) {
  if (!actor || !scene) return false;
  return collectionContents(scene.tokens).some((token) => {
    const tokenActor = token?.actor;
    return tokenActor === actor
      || (actor.uuid && tokenActor?.uuid === actor.uuid)
      || (!actor.uuid && actor.id && tokenActor?.id === actor.id);
  });
}

function isManagedImmunityItem(item) {
  return Boolean(immunityFlag(item)?.managed === true
    || item?.getFlag?.(MODULE_ID, IMMUNITY_FLAG)?.managed === true);
}

export function registerAuraRuntimeHooks(runtime, {
  hooks = globalThis.Hooks,
  canvasRef = globalThis.canvas,
  gameRef = globalThis.game
} = {}) {
  if (!hooks?.on) return [];
  const registrations = [];
  const timers = new Map();
  const pending = new Map();
  let activeScene = currentScene(canvasRef);
  const combatStates = new Map();
  for (const combat of collectionContents(gameRef?.combats)) {
    if (combat?.id) combatStates.set(combat.id, combatState(combat));
  }

  const schedule = (scene, { fireEvents = false, seed = false, presenceOnly = false } = {}) => {
    if (!scene?.id) return;
    const state = pending.get(scene.id) ?? { fireEvents: false, seed: false, presenceOnly: true };
    state.fireEvents ||= fireEvents;
    state.seed ||= seed;
    // Any full-scene request wins over a presence-only refresh.
    state.presenceOnly &&= presenceOnly;
    pending.set(scene.id, state);
    globalThis.clearTimeout(timers.get(scene.id));
    timers.set(scene.id, globalThis.setTimeout(async () => {
      timers.delete(scene.id);
      const options = pending.get(scene.id) ?? state;
      pending.delete(scene.id);
      try {
        const presenceOnlyRun = options.presenceOnly && typeof runtime.reconcilePresence === "function";
        const report = presenceOnlyRun
          ? await runtime.reconcilePresence(scene)
          : await runtime.reconcileScene(scene, options);
        const saveErrors = report?.transitions?.saveErrors ?? [];
        if (saveErrors.length > 0) {
          console.warn(`${MODULE_ID} | One or more aura saving throws could not be resolved.`, saveErrors);
        }
        const presenceErrors = presenceOnlyRun ? (report?.errors ?? []) : (report?.presence?.errors ?? []);
        if (presenceErrors.length > 0) {
          console.warn(`${MODULE_ID} | One or more aura presence effects could not be synchronized.`, presenceErrors);
        }
        const immunityErrors = report?.transitions?.immunityErrors ?? [];
        if (immunityErrors.length > 0) {
          console.warn(`${MODULE_ID} | One or more temporary aura immunities could not be synchronized.`, immunityErrors);
        }
      } catch (error) {
        console.error(`${MODULE_ID} | Aura runtime reconciliation failed.`, error);
      }
    }, RECONCILE_DELAY_MS));
  };

  const on = (name, fn) => {
    const id = hooks.on(name, fn);
    registrations.push({ name, id });
  };

  on("canvasReady", () => {
    activeScene = currentScene(canvasRef);
    schedule(activeScene, { seed: true, fireEvents: false });
  });
  on("canvasTearDown", async () => {
    const scene = activeScene ?? currentScene(canvasRef);
    if (!scene) return;
    try { await runtime.deactivateScene(scene); }
    catch (error) { console.warn(`${MODULE_ID} | Could not clean up aura presence effects during canvas teardown.`, error); }
    activeScene = null;
  });
  on("createToken", (token) => schedule(token?.parent ?? token?.scene ?? currentScene(canvasRef), { fireEvents: true }));
  on("moveToken", (token) => {
    const scene = token?.parent ?? token?.scene ?? currentScene(canvasRef);
    const animation = token?.object?.animation;
    if (animation && typeof animation.then === "function") {
      // Foundry has already updated the TokenDocument when moveToken fires, but
      // the canvas placeable may still be animating from its old position. Wait
      // for that animation before asking PF2e for its native token distance.
      Promise.resolve(animation)
        .catch(() => undefined)
        .finally(() => schedule(scene, { fireEvents: true }));
    } else {
      schedule(scene, { fireEvents: true });
    }
  });
  on("updateToken", (token, changes = {}) => schedule(
    token?.parent ?? token?.scene ?? currentScene(canvasRef),
    { fireEvents: isMovementChange(changes) }
  ));
  on("deleteToken", (token) => schedule(token?.parent ?? token?.scene ?? currentScene(canvasRef), { fireEvents: false }));
  on("updateActor", (actor) => {
    const scene = currentScene(canvasRef);
    if (actorHasTokenOnScene(actor, scene)) schedule(scene, { fireEvents: false });
  });

  const scheduleForManagedImmunity = (item) => {
    if (!isManagedImmunityItem(item)) return;
    const scene = currentScene(canvasRef);
    const actor = item?.parent ?? item?.actor ?? null;
    if (actorHasTokenOnScene(actor, scene)) schedule(scene, { presenceOnly: true });
  };
  on("createItem", (item) => scheduleForManagedImmunity(item));
  on("updateItem", (item) => scheduleForManagedImmunity(item));
  on("deleteItem", (item) => scheduleForManagedImmunity(item));
  on("updateWorldTime", () => schedule(currentScene(canvasRef), { presenceOnly: true }));
  on("updateSetting", (setting) => {
    const key = String(setting?.key ?? setting?._source?.key ?? "");
    if (key !== `${MODULE_ID}.${SETTINGS.AURA_LIBRARY}`) return;
    schedule(currentScene(canvasRef), { fireEvents: false });
  });
  const handleTurnReport = (promise) => {
    Promise.resolve(promise).then((report) => {
      const saveErrors = [
        ...(report?.turnEnd?.saveErrors ?? []),
        ...(report?.turnStart?.saveErrors ?? [])
      ];
      const immunityErrors = [
        ...(report?.turnEnd?.immunityErrors ?? []),
        ...(report?.turnStart?.immunityErrors ?? [])
      ];
      const presenceErrors = [
        ...(report?.turnEnd?.presence?.errors ?? []),
        ...(report?.turnStart?.presence?.errors ?? [])
      ];
      if (saveErrors.length > 0) console.warn(`${MODULE_ID} | One or more turn-bound aura saving throws could not be resolved.`, saveErrors);
      if (immunityErrors.length > 0) console.warn(`${MODULE_ID} | One or more temporary aura immunities could not be synchronized.`, immunityErrors);
      if (presenceErrors.length > 0) console.warn(`${MODULE_ID} | Presence state could not be refreshed after an aura turn event.`, presenceErrors);
    }).catch((error) => {
      console.error(`${MODULE_ID} | Aura combat-turn handling failed.`, error);
    });
  };

  on("combatStart", (combat, updateData = {}) => {
    const current = combatState(combat, updateData);
    if (combat?.id) combatStates.set(combat.id, current);
    Promise.resolve(runtime.handleCombatStart?.(combat, updateData)).catch((error) => {
      console.error(`${MODULE_ID} | Aura turn-start handling failed when combat started.`, error);
    });
  });

  on("combatTurnChange", (combat, prior = {}, current = {}) => {
    const priorState = combatState(combat, prior);
    const currentState = combatState(combat, current);
    if (combat?.id) combatStates.set(combat.id, currentState);
    handleTurnReport(runtime.handleCombatTurnChange?.(combat, priorState, currentState));
  });

  // Compatibility fallback: some Foundry/PF2e update paths can reach the
  // generic Combat update hook without producing the specialized turn-change
  // callback expected by the runtime. Keep a local history and feed the same
  // runtime method. The engine deduplicates this against combatTurnChange.
  on("updateCombat", (combat, changes = {}) => {
    if (!combat?.id) return;
    if (!Object.prototype.hasOwnProperty.call(changes ?? {}, "turn")
      && !Object.prototype.hasOwnProperty.call(changes ?? {}, "round")) return;
    const prior = combatStates.get(combat.id);
    const current = combatState(combat);
    combatStates.set(combat.id, current);
    if (!prior || sameCombatState(prior, current)) return;
    handleTurnReport(runtime.handleCombatTurnChange?.(combat, prior, current));
  });


  return registrations;
}
