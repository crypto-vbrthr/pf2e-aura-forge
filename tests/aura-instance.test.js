import test from "node:test";
import assert from "node:assert/strict";
import { createAuraInstance, resolveAuraInstance } from "../scripts/actor/aura-instance.js";
import { createAuraDefinition } from "../scripts/aura/aura-definition.js";

test("aura instances reference definitions instead of copying them", () => {
  const instance = createAuraInstance({ definitionId: "aura.one", definitionName: "One" });
  assert.equal(instance.definitionId, "aura.one");
  assert.equal(instance.definitionName, "One");
  assert.equal(instance.enabled, true);
  assert.deepEqual(instance.overrides, { radius: null });
});

test("instance radius override resolves without mutating the definition", () => {
  const definition = createAuraDefinition({ id: "aura.one", radius: 30 });
  const instance = createAuraInstance({ definitionId: definition.id, overrides: { radius: 15 } });
  const resolved = resolveAuraInstance(instance, definition);
  assert.equal(resolved.radius, 15);
  assert.equal(definition.radius, 30);
  assert.equal(resolved.instanceId, instance.id);
});

test("disabled instance disables the resolved aura without altering its template", () => {
  const definition = createAuraDefinition({ id: "aura.one", enabled: true });
  const instance = createAuraInstance({ definitionId: definition.id, enabled: false });
  assert.equal(resolveAuraInstance(instance, definition).enabled, false);
  assert.equal(definition.enabled, true);
});
