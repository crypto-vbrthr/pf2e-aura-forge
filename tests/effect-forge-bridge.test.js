import test from "node:test";
import assert from "node:assert/strict";
import {
  assertEffectForgeApi,
  createDefaultEmbeddedEffect,
  describeEffectForgeCompatibility,
  EffectForgeIntegrationError
} from "../scripts/integration/effect-forge-bridge.js";

function fakeBuilder() {
  const definition = { schemaVersion: 2, id: null, name: "", duration: null, components: [], metadata: {} };
  return {
    setId(value) { definition.id = value; return this; },
    setName(value) { definition.name = value; return this; },
    setDuration(value, unit, expiry) { definition.duration = { value, unit, expiry }; return this; },
    setMetadata(value) { definition.metadata = structuredClone(value); return this; },
    build() { return structuredClone(definition); }
  };
}

function compatibleApi() {
  return {
    version: "0.9.4",
    schemaVersion: 2,
    effects: { validate() { return { valid: true, errors: [], warnings: [] }; } },
    builders: { effect: () => fakeBuilder() },
    ui: { effectEditor: { createSession() {}, create() {} } }
  };
}

test("bridge accepts the public embedded editor contract", () => {
  const api = compatibleApi();
  assert.equal(assertEffectForgeApi(api), api);
  assert.equal(describeEffectForgeCompatibility(api).compatible, true);
});

test("bridge rejects a Critical Forge API without embedded editor support", () => {
  const api = compatibleApi();
  delete api.ui.effectEditor.create;
  assert.throws(() => assertEffectForgeApi(api), (error) => {
    assert.ok(error instanceof EffectForgeIntegrationError);
    assert.equal(error.code, "EFFECT_EDITOR_API_MISSING");
    return true;
  });
});

test("default embedded effects are created through the public builder", () => {
  const definition = createDefaultEmbeddedEffect(compatibleApi(), { id: "aura.effect", name: "Aura Effect" });
  assert.equal(definition.id, "aura.effect");
  assert.equal(definition.name, "Aura Effect");
  assert.deepEqual(definition.duration, { value: -1, unit: "unlimited", expiry: null });
  assert.equal(definition.metadata.originModule, "pf2e-aura-forge");
});
