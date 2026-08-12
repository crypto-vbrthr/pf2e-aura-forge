import test from "node:test";
import assert from "node:assert/strict";
import {
  cloneAuraDefinition,
  createAuraDefinition,
  createAuraTrigger,
  createPresenceEffect
} from "../scripts/aura/aura-definition.js";

function effect(id = "test.effect") {
  return {
    schemaVersion: 2,
    id,
    name: "Test Effect",
    duration: { value: -1, unit: "unlimited", expiry: null },
    components: [{ type: "modifier", selector: "ac", value: -1, modifierType: "status" }],
    application: {},
    metadata: {}
  };
}

test("createAuraDefinition provides stable schema defaults", () => {
  const aura = createAuraDefinition({ name: "Weakening Aura" });
  assert.equal(aura.schemaVersion, 1);
  assert.equal(aura.name, "Weakening Aura");
  assert.equal(aura.radius, 15);
  assert.deepEqual(aura.presenceEffects, []);
  assert.deepEqual(aura.triggers, []);
  assert.equal(aura.targeting.allies, true);
  assert.equal(aura.targeting.enemies, true);
});

test("presence effects and triggers remain separate concepts", () => {
  const aura = createAuraDefinition({
    name: "Mixed Aura",
    presenceEffects: [createPresenceEffect({ name: "AC penalty", effect: effect() })],
    triggers: [createAuraTrigger({ event: "turnEnd" })]
  });
  assert.equal(aura.presenceEffects.length, 1);
  assert.equal(aura.triggers.length, 1);
  assert.equal(aura.triggers[0].event, "turnEnd");
  assert.equal(aura.presenceEffects[0].effect.components[0].selector, "ac");
});

test("unknown top-level fields survive normalization", () => {
  const aura = createAuraDefinition({ name: "Future", futureData: { alpha: 7 } });
  assert.deepEqual(aura.futureData, { alpha: 7 });
});

test("cloneAuraDefinition can preserve identity", () => {
  const original = createAuraDefinition({ id: "aura.fixed", name: "A" });
  const copy = cloneAuraDefinition(original);
  assert.equal(copy.id, original.id);
  assert.notEqual(copy, original);
});

test("cloneAuraDefinition with newIdentity remaps nested entry ids", () => {
  const original = createAuraDefinition({
    id: "aura.fixed",
    name: "A",
    presenceEffects: [{ id: "presence.fixed", effect: effect("effect.fixed") }],
    triggers: [{ id: "trigger.fixed", outcomes: { failure: effect("failure.fixed") } }]
  });
  const copy = cloneAuraDefinition(original, { newIdentity: true, nameSuffix: " Copy" });
  assert.notEqual(copy.id, original.id);
  assert.notEqual(copy.presenceEffects[0].id, original.presenceEffects[0].id);
  assert.notEqual(copy.triggers[0].id, original.triggers[0].id);
  assert.notEqual(copy.presenceEffects[0].effect.id, original.presenceEffects[0].effect.id);
  assert.notEqual(copy.triggers[0].outcomes.failure.id, original.triggers[0].outcomes.failure.id);
  assert.equal(copy.name, "A Copy");
});
