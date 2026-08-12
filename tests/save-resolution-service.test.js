import test from "node:test";
import assert from "node:assert/strict";
import {
  AuraSaveResolutionService,
  canResolveSaveForMode,
  degreeKeyFromRoll,
  primaryActiveGM,
  resolveSaveStatistic,
  resolveSaveUser
} from "../scripts/runtime/save-resolution-service.js";

test("degreeKeyFromRoll maps PF2e degree indexes to Aura Forge outcome keys", () => {
  assert.equal(degreeKeyFromRoll({ degreeOfSuccess: 0 }), "criticalFailure");
  assert.equal(degreeKeyFromRoll({ degreeOfSuccess: 1 }), "failure");
  assert.equal(degreeKeyFromRoll({ degreeOfSuccess: 2 }), "success");
  assert.equal(degreeKeyFromRoll({ degreeOfSuccess: 3 }), "criticalSuccess");
  assert.equal(degreeKeyFromRoll({ degreeOfSuccess: null }), null);
});

test("request mode prefers an active player owner even when PF2e primaryUpdater is an active GM", () => {
  const gm = { id: "gm", isGM: true, active: true };
  const player = { id: "player", isGM: false, active: true, character: { id: "target" } };
  const actor = { id: "target", primaryUpdater: gm };
  const users = { contents: [gm, player], activeGM: gm };

  assert.equal(resolveSaveUser(actor, "request", { user: player, users }), player);
  assert.equal(canResolveSaveForMode(actor, "request", { user: player, users }), true);
  assert.equal(canResolveSaveForMode(actor, "request", { user: gm, users }), false);
});

test("automatic mode resolves on exactly one active GM when one exists", () => {
  const gm = { id: "gm", isGM: true, active: true };
  const player = { id: "player", isGM: false, active: true, character: { id: "target" } };
  const actor = { id: "target", primaryUpdater: gm };
  const users = { contents: [player, gm], activeGM: gm };

  assert.equal(resolveSaveUser(actor, "automatic", { user: gm, users }), gm);
  assert.equal(canResolveSaveForMode(actor, "automatic", { user: gm, users }), true);
  assert.equal(canResolveSaveForMode(actor, "automatic", { user: player, users }), false);
});

test("gm mode resolves only on the primary active GM", () => {
  const gm1 = { id: "a", isGM: true, active: true };
  const gm2 = { id: "b", isGM: true, active: true };
  const users = { contents: [gm2, gm1] };
  assert.equal(primaryActiveGM({ users }), gm1);
  assert.equal(canResolveSaveForMode({}, "gm", { user: gm1, users }), true);
  assert.equal(canResolveSaveForMode({}, "gm", { user: gm2, users }), false);
});

test("save statistic resolves from actor.saves with getStatistic fallback", () => {
  const fort = { roll() {} };
  assert.equal(resolveSaveStatistic({ saves: { fortitude: fort } }, "fortitude"), fort);
  const will = { roll() {} };
  assert.equal(resolveSaveStatistic({ getStatistic: (slug) => slug === "will" ? will : null }, "will"), will);
});

test("request mode opens the native PF2e roll dialog and returns degree", async () => {
  const user = { id: "player", isGM: false };
  const calls = [];
  const actor = {
    primaryUpdater: user,
    saves: {
      will: {
        label: "Will",
        async roll(options) {
          calls.push(options);
          return { degreeOfSuccess: 1 };
        }
      }
    }
  };
  const service = new AuraSaveResolutionService({ gameRef: { user } });
  const result = await service.roll({
    targetActor: actor,
    targetToken: { id: "target" },
    sourceActor: { id: "source" },
    aura: { id: "aura.fear", name: "Fear Aura" },
    trigger: {
      id: "trigger.enter",
      name: "Dread",
      event: "enter",
      save: { enabled: true, type: "will", mode: "request", dc: { value: 25 } }
    }
  });
  assert.equal(result.status, "resolved");
  assert.equal(result.degree, "failure");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].dc, 25);
  assert.equal(calls[0].skipDialog, false);
  assert.match(calls[0].title, /Fear Aura/);
});

test("automatic mode skips the native PF2e roll dialog", async () => {
  const user = { id: "player", isGM: false };
  let options;
  const actor = {
    primaryUpdater: user,
    saves: { reflex: { async roll(value) { options = value; return { degreeOfSuccess: 3 }; } } }
  };
  const service = new AuraSaveResolutionService({ gameRef: { user } });
  const result = await service.roll({
    targetActor: actor,
    trigger: {
      id: "trigger.enter",
      event: "enter",
      save: { enabled: true, type: "reflex", mode: "automatic", dc: { value: 20 } }
    },
    aura: { id: "aura.test", name: "Test" }
  });
  assert.equal(result.degree, "criticalSuccess");
  assert.equal(options.skipDialog, true);
});
