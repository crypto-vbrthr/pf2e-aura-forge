import test from "node:test";
import assert from "node:assert/strict";
import { AuraRuntimeEngine } from "../scripts/runtime/aura-runtime-engine.js";
import { presenceBindingFlag } from "../scripts/runtime/presence-binding-service.js";
import { createAuraDefinition } from "../scripts/aura/aura-definition.js";

const USER = { id: "gm", isGM: true };

class MockItem {
  constructor(id, source, actor) {
    this.id = id;
    this.actor = actor;
    this.parent = actor;
    this.flags = structuredClone(source.flags ?? {});
    this.name = source.name ?? "Effect";
    this.deleted = false;
  }
  getFlag(scope, key) { return this.flags?.[scope]?.[key]; }
  async setFlag(scope, key, value) {
    this.flags[scope] ??= {};
    this.flags[scope][key] = structuredClone(value);
    return this;
  }
  async delete() {
    this.deleted = true;
    this.actor.items = this.actor.items.filter((item) => item !== this);
  }
}

class MockActor {
  constructor(id, alliance) {
    this.id = id;
    this.uuid = `Actor.${id}`;
    this.alliance = alliance;
    this.primaryUpdater = USER;
    this.items = [];
    this.system = { traits: { value: [] } };
  }
  isAllyOf(other) { return this !== other && this.alliance === other?.alliance && this.alliance !== "neutral"; }
  isEnemyOf(other) { return this.alliance !== "neutral" && other?.alliance !== "neutral" && this.alliance !== other.alliance; }
  async deleteEmbeddedDocuments(_type, ids) {
    this.items = this.items.filter((item) => !ids.includes(item.id));
    return ids;
  }
}

function collection(tokens) {
  return {
    contents: tokens,
    get(id) { return tokens.find((token) => token.id === id) ?? null; },
    some(fn) { return tokens.some(fn); },
    [Symbol.iterator]() { return tokens[Symbol.iterator](); }
  };
}

function makeToken(id, actor, x) {
  return { id, uuid: `Scene.scene.Token.${id}`, actor, x, y: 0, width: 1, height: 1, hidden: false };
}

function effect(id, name = id) {
  return {
    schemaVersion: 2,
    id,
    name,
    duration: { value: -1, unit: "unlimited", expiry: null },
    components: [{ type: "modifier", selector: "ac", value: -1, modifierType: "status" }]
  };
}

function setup({ saveEnter = false, saveMode = "request", saveDegree = 2 } = {}) {
  const sourceActor = new MockActor("source", "opposition");
  const targetActor = new MockActor("target", "party");
  const saveCalls = [];
  targetActor.saves = {
    fortitude: {
      label: "Fortitude",
      async roll(options) {
        saveCalls.push(options);
        return { degreeOfSuccess: saveDegree };
      }
    }
  };
  const allyActor = new MockActor("ally", "opposition");
  const sourceToken = makeToken("source-token", sourceActor, 0);
  const targetToken = makeToken("target-token", targetActor, 200); // 5 ft from source edge
  const allyToken = makeToken("ally-token", allyActor, 200);
  const tokens = [sourceToken, targetToken, allyToken];
  const scene = { id: "scene", grid: { size: 100, distance: 5 }, tokens: collection(tokens) };
  sourceToken.scene = targetToken.scene = allyToken.scene = scene;

  const aura = createAuraDefinition({
    id: "aura.fear",
    name: "Fear Aura",
    radius: 10,
    targeting: { allies: false, enemies: true, neutral: false, source: false },
    presenceEffects: [{ id: "presence.ac", name: "AC", effect: effect("presence.effect") }],
    triggers: [
      {
        id: "trigger.enter",
        event: "enter",
        save: { enabled: saveEnter, type: "fortitude", mode: saveMode, dc: { value: 22 } },
        outcomes: {
          criticalSuccess: effect("enter.critical-success", "Critical Success"),
          success: effect("enter.effect", "Enter Effect"),
          failure: effect("enter.failure", "Enter Failure"),
          criticalFailure: effect("enter.critical-failure", "Critical Failure")
        }
      },
      {
        id: "trigger.leave",
        event: "leave",
        save: { enabled: false },
        outcomes: { success: effect("leave.effect", "Leave Effect") }
      }
    ]
  });
  const instance = { id: "instance.1", definitionId: aura.id, enabled: true, overrides: {} };
  const actorAuras = {
    list(actor) { return actor === sourceActor ? [instance] : []; },
    async resolve(actor, id) {
      if (actor !== sourceActor || id !== instance.id) return null;
      return { instance, definition: aura, resolved: structuredClone(aura), missingDefinition: false };
    }
  };
  const calls = [];
  let itemCounter = 0;
  const effectApi = {
    effects: {
      async apply(definition, actor, options) {
        calls.push({ definition: structuredClone(definition), actor, options });
        const item = new MockItem(`effect.${++itemCounter}`, {
          name: definition.name,
          flags: {
            "pf2e-critical-forge": {
              definitionId: definition.id,
              definition: structuredClone(definition)
            }
          }
        }, actor);
        actor.items.push(item);
        return [item];
      }
    }
  };
  const gameRef = { user: USER, actors: { contents: [sourceActor, targetActor, allyActor] } };
  const runtime = new AuraRuntimeEngine({
    library: { async get() { return structuredClone(aura); } },
    actorAuras,
    effectApi,
    gameRef
  });
  return { runtime, aura, scene, sourceActor, targetActor, allyActor, sourceToken, targetToken, allyToken, calls, saveCalls };
}

function presenceItems(actor) {
  return actor.items.filter((item) => presenceBindingFlag(item));
}

test("first scene reconciliation reconstructs presence without firing enter", async () => {
  const { runtime, scene, targetActor, allyActor, calls } = setup();
  const report = await runtime.reconcileScene(scene, { seed: true, fireEvents: false });
  assert.equal(report.presence.applied, 1);
  assert.equal(presenceItems(targetActor).length, 1);
  assert.equal(presenceItems(allyActor).length, 0);
  assert.equal(calls.filter((call) => call.definition.id === "enter.effect").length, 0);
});

test("presence effects do not duplicate on repeated reconciliation", async () => {
  const { runtime, scene, targetActor } = setup();
  await runtime.reconcileScene(scene, { seed: true, fireEvents: false });
  await runtime.reconcileScene(scene, { fireEvents: false });
  assert.equal(presenceItems(targetActor).length, 1);
});

test("moving out removes bound presence and fires leave trigger", async () => {
  const { runtime, scene, targetActor, targetToken, calls } = setup();
  await runtime.reconcileScene(scene, { seed: true, fireEvents: false });
  targetToken.x = 500;
  const report = await runtime.reconcileScene(scene, { fireEvents: true });
  assert.equal(report.presence.removed, 1);
  assert.equal(presenceItems(targetActor).length, 0);
  assert.equal(calls.filter((call) => call.definition.id === "leave.effect").length, 1);
});

test("moving into an aura applies presence and fires enter trigger", async () => {
  const { runtime, scene, targetActor, targetToken, calls } = setup();
  targetToken.x = 500;
  await runtime.reconcileScene(scene, { seed: true, fireEvents: false });
  targetToken.x = 200;
  const report = await runtime.reconcileScene(scene, { fireEvents: true });
  assert.equal(report.transitions.entered, 1);
  assert.equal(presenceItems(targetActor).length, 1);
  assert.equal(calls.filter((call) => call.definition.id === "enter.effect").length, 1);
});

test("save-enabled enter trigger requests the PF2e save and applies the matching outcome", async () => {
  const { runtime, scene, targetToken, calls, saveCalls } = setup({ saveEnter: true, saveDegree: 1 });
  targetToken.x = 500;
  await runtime.reconcileScene(scene, { seed: true, fireEvents: false });
  targetToken.x = 200;
  const report = await runtime.reconcileScene(scene, { fireEvents: true });
  assert.equal(report.transitions.deferredSaves, 0);
  assert.equal(report.transitions.savesResolved, 1);
  assert.equal(saveCalls.length, 1);
  assert.equal(saveCalls[0].dc, 22);
  assert.equal(saveCalls[0].skipDialog, false);
  assert.equal(calls.filter((call) => call.definition.id === "enter.failure").length, 1);
  assert.equal(calls.filter((call) => call.definition.id === "enter.effect").length, 0);
});


test("enter save resolves before a failing presence application can report an Actor data-preparation error", async () => {
  const state = setup({ saveEnter: true, saveDegree: 2 });
  const { runtime, scene, targetToken, saveCalls, calls } = state;
  const originalApply = runtime.presenceBindings.effectApi.effects.apply;
  runtime.presenceBindings.effectApi.effects.apply = async (definition, actor, options) => {
    if (definition.id === "presence.effect") {
      throw new Error("simulated PF2e Actor data-preparation failure");
    }
    return originalApply(definition, actor, options);
  };

  targetToken.x = 500;
  await runtime.reconcileScene(scene, { seed: true, fireEvents: false });
  targetToken.x = 200;
  const report = await runtime.reconcileScene(scene, { fireEvents: true });

  assert.equal(saveCalls.length, 1);
  assert.equal(report.transitions.savesResolved, 1);
  assert.equal(calls.filter((call) => call.definition.id === "enter.effect").length, 1);
  assert.equal(report.presence.applied, 0);
  assert.equal(report.presence.errors.length, 1);
  assert.equal(report.presence.errors[0].phase, "presence-apply");
});

test("automatic save mode skips the dialog and applies critical-success outcome", async () => {
  const { runtime, scene, targetToken, calls, saveCalls } = setup({ saveEnter: true, saveMode: "automatic", saveDegree: 3 });
  targetToken.x = 500;
  await runtime.reconcileScene(scene, { seed: true, fireEvents: false });
  targetToken.x = 200;
  const report = await runtime.reconcileScene(scene, { fireEvents: true });
  assert.equal(report.transitions.savesResolved, 1);
  assert.equal(saveCalls[0].skipDialog, true);
  assert.equal(calls.filter((call) => call.definition.id === "enter.critical-success").length, 1);
});

test("changed presence definitions replace the runtime-bound effect", async () => {
  const state = setup();
  const { runtime, scene, targetActor, aura } = state;
  await runtime.reconcileScene(scene, { seed: true, fireEvents: false });
  const firstId = presenceItems(targetActor)[0].id;
  aura.presenceEffects[0].effect.name = "Changed";
  aura.presenceEffects[0].effect.components[0].value = -2;
  // ActorAuraService resolve in this fixture returns the mutable current aura.
  state.runtime.actorAuras.resolve = async () => ({
    instance: { id: "instance.1" }, definition: aura, resolved: structuredClone(aura), missingDefinition: false
  });
  const report = await runtime.reconcileScene(scene, { fireEvents: false });
  assert.equal(report.presence.removed, 1);
  assert.equal(report.presence.applied, 1);
  assert.equal(presenceItems(targetActor).length, 1);
  assert.notEqual(presenceItems(targetActor)[0].id, firstId);
});

test("only the target actor primary updater mutates actor effects", async () => {
  const { runtime, scene, targetActor } = setup();
  targetActor.primaryUpdater = { id: "other", isGM: true };
  const report = await runtime.reconcileScene(scene, { seed: true, fireEvents: false });
  assert.equal(report.presence.applied, 0);
  assert.equal(presenceItems(targetActor).length, 0);
});

test("deactivateScene removes presence effects but does not synthesize leave", async () => {
  const { runtime, scene, targetActor, calls } = setup();
  await runtime.reconcileScene(scene, { seed: true, fireEvents: false });
  const result = await runtime.deactivateScene(scene);
  assert.equal(result.removed, 1);
  assert.equal(presenceItems(targetActor).length, 0);
  assert.equal(calls.filter((call) => call.definition.id === "leave.effect").length, 0);
});

test("GM runtime coordinator routes request-mode saves through the socket service instead of suppressing them", async () => {
  const state = setup({ saveEnter: true, saveMode: "request", saveDegree: 2 });
  const { runtime, scene, targetToken, calls } = state;
  const gm = USER;
  gm.active = true;
  const player = { id: "player", isGM: false, active: true, character: { id: "target" } };
  runtime.gameRef.users = { contents: [gm, player], activeGM: gm };

  const requests = [];
  runtime.setSocketService({
    async resolveSave(request) {
      requests.push(request);
      return { status: "resolved", degree: "failure", saveType: "fortitude", dc: 22 };
    }
  });

  targetToken.x = 500;
  await runtime.reconcileScene(scene, { seed: true, fireEvents: false });
  targetToken.x = 200;
  const report = await runtime.reconcileScene(scene, { fireEvents: true });

  assert.equal(requests.length, 1);
  assert.equal(report.transitions.savesResolved, 1);
  assert.equal(calls.filter((call) => call.definition.id === "enter.failure").length, 1);
});
