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
    "canvasReady", "canvasTearDown", "createToken", "moveToken", "updateToken", "deleteToken", "updateActor",
    "createItem", "updateItem", "deleteItem", "updateWorldTime", "updateSetting", "combatStart", "combatTurnChange", "updateCombat", "deleteCombat"
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


test("combatTurnChange delegates prior/current combat history to the runtime", async () => {
  const hooks = new HookBus();
  const calls = [];
  const runtime = {
    async reconcileScene() {},
    async deactivateScene() {},
    async handleCombatTurnChange(combat, prior, current) { calls.push({ combat, prior, current }); return {}; }
  };
  registerAuraRuntimeHooks(runtime, { hooks, canvasRef: { scene: null } });
  const combat = { id: "combat" };
  const prior = { round: 1, turn: 0, tokenId: "a" };
  const current = { round: 1, turn: 1, tokenId: "b" };
  hooks.call("combatTurnChange", combat, prior, current);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(calls.length, 1);
  assert.equal(calls[0].prior.tokenId, "a");
  assert.equal(calls[0].current.tokenId, "b");
});

test("combatStart delegates initial turn handling to the runtime", async () => {
  const hooks = new HookBus();
  const calls = [];
  const runtime = {
    async reconcileScene() {},
    async deactivateScene() {},
    async handleCombatStart(combat, updateData) { calls.push({ combat, updateData }); return {}; }
  };
  registerAuraRuntimeHooks(runtime, { hooks, canvasRef: { scene: null } });
  const combat = { id: "combat" };
  hooks.call("combatStart", combat, { round: 1, turn: 0 });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(calls.length, 1);
  assert.equal(calls[0].updateData.turn, 0);
});


test("updateCombat fallback reconstructs prior/current turn state when the specialized hook is missed", async () => {
  const hooks = new HookBus();
  const scene = { id: "scene" };
  const calls = [];
  const combat = {
    id: "combat-fallback",
    scene,
    round: 1,
    turn: 0,
    turns: [{ id: "ca", tokenId: "a" }, { id: "cb", tokenId: "b" }]
  };
  const runtime = {
    async reconcileScene() {},
    async deactivateScene() {},
    async handleCombatTurnChange(_combat, prior, current) { calls.push({ prior, current }); return {}; }
  };
  registerAuraRuntimeHooks(runtime, {
    hooks,
    canvasRef: { scene },
    gameRef: { combats: { contents: [combat] } }
  });

  combat.turn = 1;
  hooks.call("updateCombat", combat, { turn: 1 });
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(calls.length, 1);
  assert.equal(calls[0].prior.tokenId, "a");
  assert.equal(calls[0].current.tokenId, "b");
  assert.equal(calls[0].prior.turn, 0);
  assert.equal(calls[0].current.turn, 1);
});


test("world-time changes schedule a presence-only reconciliation so expired immunity can restore presence", async () => {
  const hooks = new HookBus();
  const scene = { id: "scene", tokens: { contents: [] } };
  const calls = [];
  const runtime = {
    async reconcileScene() { calls.push("scene"); },
    async reconcilePresence() { calls.push("presence"); return {}; },
    async deactivateScene() {}
  };
  registerAuraRuntimeHooks(runtime, { hooks, canvasRef: { scene } });

  hooks.call("updateWorldTime", 1061, 61, {}, "gm");
  await new Promise((resolve) => setTimeout(resolve, 80));
  assert.deepEqual(calls, ["presence"]);
});

test("managed immunity item changes schedule presence-only reconciliation for an Actor on the scene", async () => {
  const hooks = new HookBus();
  const actor = { id: "target", uuid: "Actor.target" };
  const scene = { id: "scene", tokens: { contents: [{ actor }] } };
  const calls = [];
  const runtime = {
    async reconcileScene() { calls.push("scene"); },
    async reconcilePresence() { calls.push("presence"); return {}; },
    async deactivateScene() {}
  };
  registerAuraRuntimeHooks(runtime, { hooks, canvasRef: { scene } });
  const item = {
    parent: actor,
    flags: { "pf2e-aura-forge": { auraImmunity: { managed: true } } }
  };

  hooks.call("deleteItem", item);
  await new Promise((resolve) => setTimeout(resolve, 80));
  assert.deepEqual(calls, ["presence"]);
});


test("canvas teardown cancels queued and late animation reconciliation for the old scene", async () => {
  const hooks = new HookBus();
  const scene = { id: "scene" };
  const calls = [];
  const canvasRef = { scene };
  const runtime = {
    async reconcileScene() { calls.push("reconcile"); },
    async deactivateScene() { calls.push("deactivate"); }
  };
  registerAuraRuntimeHooks(runtime, { hooks, canvasRef });

  hooks.call("updateToken", { parent: scene }, { x: 100 });
  await hooks.call("canvasTearDown");
  await new Promise((resolve) => setTimeout(resolve, 90));
  assert.deepEqual(calls, ["deactivate"]);

  let finishAnimation;
  const animation = new Promise((resolve) => { finishAnimation = resolve; });
  hooks.call("moveToken", { parent: scene, object: { animation } });
  finishAnimation();
  await new Promise((resolve) => setTimeout(resolve, 90));
  assert.deepEqual(calls, ["deactivate"]);

  canvasRef.scene = scene;
  hooks.call("canvasReady");
  await new Promise((resolve) => setTimeout(resolve, 90));
  assert.deepEqual(calls, ["deactivate", "reconcile"]);
});

test("deleteCombat clears local and runtime combat-event history", () => {
  const hooks = new HookBus();
  const resets = [];
  const runtime = {
    reconcileScene() {},
    deactivateScene() {},
    resetCombat(id) { resets.push(id); }
  };
  const combat = { id: "combat-delete", round: 1, turn: 0, turns: [] };
  registerAuraRuntimeHooks(runtime, {
    hooks,
    canvasRef: { scene: null },
    gameRef: { combats: { contents: [combat] } }
  });

  hooks.call("deleteCombat", combat);
  assert.deepEqual(resets, ["combat-delete"]);
});

test("library setting changes reconcile Actor aura proxies on every client before scene runtime refresh", async () => {
  const hooks = new HookBus();
  const scene = { id: "scene", tokens: { contents: [] } };
  const calls = [];
  const runtime = {
    actorAuras: {
      async reconcileAll(actors) { calls.push(["proxies", actors.length]); }
    },
    async reconcileScene() { calls.push(["scene"]); return {}; },
    async deactivateScene() {}
  };
  registerAuraRuntimeHooks(runtime, {
    hooks,
    canvasRef: { scene },
    gameRef: { actors: { contents: [{ id: "a" }, { id: "b" }] } }
  });

  hooks.call("updateSetting", { key: "pf2e-aura-forge.auraLibrary" });
  await new Promise((resolve) => setTimeout(resolve, 80));

  assert.deepEqual(calls[0], ["proxies", 2]);
  assert.deepEqual(calls[1], ["scene"]);
});
