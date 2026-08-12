import test from "node:test";
import assert from "node:assert/strict";
import { createAuraDefinition } from "../scripts/aura/aura-definition.js";
import { buildPresenceBindingKey, planPresenceReconciliation } from "../scripts/engine/presence-reconciliation.js";

const effect = { schemaVersion: 2, id: "effect.ac", name: "AC", components: [{ type: "modifier", selector: "ac", value: -1, modifierType: "status" }] };

function aura() {
  return createAuraDefinition({
    id: "aura.weak",
    name: "Weak",
    targeting: { allies: false, enemies: true, neutral: false, source: false },
    presenceEffects: [{ id: "presence.ac", effect }]
  });
}

test("missing presence bindings are planned for application", () => {
  const plan = planPresenceReconciliation({
    aura: aura(),
    sourceTokenId: "source",
    candidates: [{ tokenId: "target", disposition: "enemy" }],
    activeBindings: new Set(),
    isInside: () => true
  });
  assert.equal(plan.add.length, 1);
  assert.equal(plan.remove.length, 0);
  assert.equal(plan.add[0].targetTokenId, "target");
});

test("existing presence bindings are not added twice", () => {
  const key = buildPresenceBindingKey({ auraId: "aura.weak", presenceEffectId: "presence.ac", sourceTokenId: "source", targetTokenId: "target" });
  const plan = planPresenceReconciliation({
    aura: aura(), sourceTokenId: "source",
    candidates: [{ tokenId: "target", disposition: "enemy" }],
    activeBindings: new Set([key]),
    isInside: () => true
  });
  assert.equal(plan.add.length, 0);
  assert.equal(plan.remove.length, 0);
});

test("stale presence bindings are planned for removal when a target leaves", () => {
  const key = buildPresenceBindingKey({ auraId: "aura.weak", presenceEffectId: "presence.ac", sourceTokenId: "source", targetTokenId: "target" });
  const plan = planPresenceReconciliation({
    aura: aura(), sourceTokenId: "source",
    candidates: [{ tokenId: "target", disposition: "enemy" }],
    activeBindings: new Set([key]),
    isInside: () => false
  });
  assert.equal(plan.add.length, 0);
  assert.deepEqual(plan.remove, [{ key }]);
});

test("reload reconstruction works from desired state without an enter event", () => {
  const plan = planPresenceReconciliation({
    aura: aura(), sourceTokenId: "source",
    candidates: [{ tokenId: "already-inside", disposition: "enemy" }],
    activeBindings: new Set(),
    isInside: () => true
  });
  assert.equal(plan.add.length, 1);
  assert.equal(plan.add[0].targetTokenId, "already-inside");
});
