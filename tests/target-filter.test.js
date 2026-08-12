import test from "node:test";
import assert from "node:assert/strict";
import { createAuraDefinition } from "../scripts/aura/aura-definition.js";
import { matchesAuraTarget } from "../scripts/engine/target-filter.js";

test("source targeting is independent from disposition targeting", () => {
  const aura = createAuraDefinition({ name: "Aura", targeting: { allies: false, enemies: true, source: false } });
  assert.equal(matchesAuraTarget(aura, { isSource: true, disposition: "enemy" }), false);
  aura.targeting.source = true;
  assert.equal(matchesAuraTarget(aura, { isSource: true, disposition: "ally" }), true);
});

test("required and excluded traits are enforced", () => {
  const aura = createAuraDefinition({
    name: "Aura",
    targeting: { enemies: true, allies: false, requiredTraits: ["undead"], excludedTraits: ["mindless"] }
  });
  assert.equal(matchesAuraTarget(aura, { disposition: "enemy", traits: ["undead"] }), true);
  assert.equal(matchesAuraTarget(aura, { disposition: "enemy", traits: ["undead", "mindless"] }), false);
  assert.equal(matchesAuraTarget(aura, { disposition: "enemy", traits: [] }), false);
});
