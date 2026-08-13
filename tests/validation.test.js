import test from "node:test";
import assert from "node:assert/strict";
import { createAuraDefinition } from "../scripts/aura/aura-definition.js";
import { validateAuraDefinition } from "../scripts/aura/aura-validator.js";

const validEffect = {
  schemaVersion: 2,
  id: "effect.valid",
  name: "Effect",
  components: [{ type: "modifier", selector: "ac", value: -1, modifierType: "status" }]
};

const effectApi = {
  validate(definition) {
    return definition?.components?.length
      ? { valid: true, errors: [], warnings: [] }
      : { valid: false, errors: ["At least one component is required."], warnings: [] };
  }
};

test("a complete aura validates", () => {
  const aura = createAuraDefinition({
    name: "Rot",
    presenceEffects: [{ id: "presence.1", effect: validEffect }],
    triggers: [{
      id: "trigger.1",
      event: "turnEnd",
      save: { enabled: true, type: "fortitude", mode: "request", dc: { mode: "fixed", value: 27 } },
      outcomes: { failure: validEffect },
      immunity: { enabled: true, duration: { value: 1, unit: "minutes" }, scope: "ability", applyOn: ["success"] }
    }]
  });
  const report = validateAuraDefinition(aura, { effectApi });
  assert.equal(report.valid, true);
  assert.equal(report.errors.length, 0);
});

test("presence effect without an Effect Definition is rejected", () => {
  const aura = createAuraDefinition({ name: "Bad", presenceEffects: [{ id: "presence.1", effect: null }] });
  const report = validateAuraDefinition(aura, { effectApi });
  assert.equal(report.valid, false);
  assert.ok(report.errors.some((entry) => entry.code === "EFFECT_REQUIRED"));
});

test("duplicate trigger ids are rejected", () => {
  const aura = createAuraDefinition({
    name: "Duplicate",
    triggers: [
      { id: "same", event: "enter", outcomes: { failure: validEffect } },
      { id: "same", event: "leave", outcomes: { failure: validEffect } }
    ]
  });
  const report = validateAuraDefinition(aura, { effectApi });
  assert.ok(report.errors.some((entry) => entry.code === "TRIGGER_ID_DUPLICATE"));
});

test("invalid save DC is rejected only when the save is enabled", () => {
  const disabled = createAuraDefinition({ name: "Disabled", triggers: [{ event: "enter", save: { enabled: false, dc: { value: 0 } }, outcomes: { failure: validEffect } }] });
  assert.equal(validateAuraDefinition(disabled, { effectApi }).errors.some((entry) => entry.code === "SAVE_DC_INVALID"), false);

  const enabled = createAuraDefinition({ name: "Enabled", triggers: [{ event: "enter", save: { enabled: true, dc: { mode: "fixed", value: 0 } }, outcomes: { failure: validEffect } }] });
  assert.equal(validateAuraDefinition(enabled, { effectApi }).errors.some((entry) => entry.code === "SAVE_DC_INVALID"), true);
});

test("trigger without outcomes is a warning, not an error", () => {
  const aura = createAuraDefinition({ name: "Warning", triggers: [{ event: "turnEnd" }] });
  const report = validateAuraDefinition(aura, { effectApi });
  assert.equal(report.valid, true);
  assert.ok(report.warnings.some((entry) => entry.code === "TRIGGER_WITHOUT_OUTCOME"));
});


test("instant damage and death are rejected as Presence Effects", () => {
  for (const component of [
    { type: "damage", formula: "1d6", damageType: "fire" },
    { type: "death", category: "direct" }
  ]) {
    const aura = createAuraDefinition({
      name: "Unsafe Presence",
      presenceEffects: [{
        id: `presence.${component.type}`,
        effect: { ...validEffect, id: `effect.${component.type}`, components: [component] }
      }]
    });
    const report = validateAuraDefinition(aura, { effectApi });
    assert.equal(report.valid, false);
    assert.ok(report.errors.some((entry) => entry.code === "PRESENCE_INSTANT_COMPONENT_UNSUPPORTED"));
  }
});

test("instant damage and death are valid Event Effect outcomes", () => {
  const aura = createAuraDefinition({
    name: "Event Doom",
    triggers: [{
      id: "trigger.instant",
      event: "turnEnd",
      save: { enabled: false },
      outcomes: {
        success: {
          ...validEffect,
          id: "effect.instant",
          components: [
            { type: "damage", formula: "2d6", damageType: "void" },
            { type: "death", category: "death-effect" }
          ]
        }
      }
    }]
  });
  const report = validateAuraDefinition(aura, { effectApi });
  assert.equal(report.valid, true);
  assert.equal(report.errors.some((entry) => entry.code === "PRESENCE_INSTANT_COMPONENT_UNSUPPORTED"), false);
});
