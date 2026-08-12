import { MODULE_ID, SETTINGS } from "../constants.js";

const RECONCILE_DELAY_MS = 60;

function currentScene(canvasRef = globalThis.canvas) {
  return canvasRef?.scene ?? null;
}

function isMovementChange(changes = {}) {
  return ["x", "y", "elevation"].some((key) => Object.prototype.hasOwnProperty.call(changes ?? {}, key));
}

export function registerAuraRuntimeHooks(runtime, {
  hooks = globalThis.Hooks,
  canvasRef = globalThis.canvas
} = {}) {
  if (!hooks?.on) return [];
  const registrations = [];
  const timers = new Map();
  const pending = new Map();
  let activeScene = currentScene(canvasRef);

  const schedule = (scene, { fireEvents = false, seed = false } = {}) => {
    if (!scene?.id) return;
    const state = pending.get(scene.id) ?? { fireEvents: false, seed: false };
    state.fireEvents ||= fireEvents;
    state.seed ||= seed;
    pending.set(scene.id, state);
    globalThis.clearTimeout(timers.get(scene.id));
    timers.set(scene.id, globalThis.setTimeout(async () => {
      timers.delete(scene.id);
      const options = pending.get(scene.id) ?? state;
      pending.delete(scene.id);
      try {
        const report = await runtime.reconcileScene(scene, options);
        const saveErrors = report?.transitions?.saveErrors ?? [];
        if (saveErrors.length > 0) {
          console.warn(`${MODULE_ID} | One or more aura saving throws could not be resolved.`, saveErrors);
        }
        const presenceErrors = report?.presence?.errors ?? [];
        if (presenceErrors.length > 0) {
          console.warn(`${MODULE_ID} | One or more aura presence effects could not be synchronized.`, presenceErrors);
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
    if (!scene) return;
    const hasToken = scene.tokens?.some?.((token) => token.actor?.uuid === actor?.uuid)
      ?? false;
    if (hasToken) schedule(scene, { fireEvents: false });
  });
  on("updateSetting", (setting) => {
    const key = String(setting?.key ?? setting?._source?.key ?? "");
    if (key !== `${MODULE_ID}.${SETTINGS.AURA_LIBRARY}`) return;
    schedule(currentScene(canvasRef), { fireEvents: false });
  });

  return registrations;
}
