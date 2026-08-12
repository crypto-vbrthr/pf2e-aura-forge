import test from "node:test";
import assert from "node:assert/strict";
import { registerAuraRuntimeHooks } from "../scripts/runtime/runtime-hooks.js";

class HookBus {
  constructor() { this.callbacks = new Map(); this.id = 0; }
  on(name, fn) { this.callbacks.set(name, fn); return ++this.id; }
  call(name, ...args) { return this.callbacks.get(name)?.(...args); }
}

test("runtime hooks cover canvas lifecycle, tokens, actors, and library settings", () => {
  const hooks = new HookBus();
  const runtime = { reconcileScene() {}, deactivateScene() {} };
  const registrations = registerAuraRuntimeHooks(runtime, { hooks, canvasRef: { scene: null } });
  assert.deepEqual(registrations.map((entry) => entry.name), [
    "canvasReady", "canvasTearDown", "createToken", "moveToken", "updateToken", "deleteToken", "updateActor", "updateSetting"
  ]);
});


test("moveToken waits for the canvas movement animation before reconciling", async () => {
  const hooks = new HookBus();
  const scene = { id: "scene" };
  const calls = [];
  const runtime = {
    async reconcileScene(_scene, options) { calls.push(options); },
    async deactivateScene() {}
  };
  registerAuraRuntimeHooks(runtime, { hooks, canvasRef: { scene } });

  let finishAnimation;
  const animation = new Promise((resolve) => { finishAnimation = resolve; });
  hooks.call("moveToken", { parent: scene, object: { animation } });
  await new Promise((resolve) => setTimeout(resolve, 80));
  assert.equal(calls.length, 0);

  finishAnimation();
  await new Promise((resolve) => setTimeout(resolve, 80));
  assert.equal(calls.length, 1);
  assert.equal(calls[0].fireEvents, true);
});

test("updateToken treats coordinate changes as transition-capable on every client", async () => {
  const hooks = new HookBus();
  const scene = { id: "scene" };
  const calls = [];
  const runtime = {
    async reconcileScene(_scene, options) { calls.push(options); },
    async deactivateScene() {}
  };
  registerAuraRuntimeHooks(runtime, { hooks, canvasRef: { scene } });

  hooks.call("updateToken", { parent: scene }, { x: 300 });
  await new Promise((resolve) => setTimeout(resolve, 80));
  assert.equal(calls.length, 1);
  assert.equal(calls[0].fireEvents, true);

  hooks.call("updateToken", { parent: scene }, { name: "No movement" });
  await new Promise((resolve) => setTimeout(resolve, 80));
  assert.equal(calls.length, 2);
  assert.equal(calls[1].fireEvents, false);
});
