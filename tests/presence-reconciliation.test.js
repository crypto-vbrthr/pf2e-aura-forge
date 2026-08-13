import test from "node:test";
import assert from "node:assert/strict";
import { createAuraDefinition } from "../scripts/aura/aura-definition.js";
import { AuraEngineCore } from "../scripts/engine/aura-engine-core.js";
import {
  buildPresenceBindingKey,
  buildRuntimePresenceBindingKey,
  planPresenceReconciliation,
  planRuntimePresenceReconciliation
} from "../scripts/engine/presence-reconciliation.js";

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


test("runtime planner uses scene/instance/actor identity and groups multiple tokens of one Actor", () => {
  const plan = planRuntimePresenceReconciliation({
    sceneId: "scene.1",
    aura: aura(),
    instanceId: "instance.1",
    sourceActorUuid: "Actor.source",
    sourceTokenId: "source",
    candidates: [
      { tokenId: "target-a", actorUuid: "Actor.target", disposition: "enemy" },
      { tokenId: "target-b", actorUuid: "Actor.target", disposition: "enemy" }
    ],
    activeBindings: new Set(),
    isInside: () => true
  });

  const key = buildRuntimePresenceBindingKey({
    sceneId: "scene.1",
    sourceTokenId: "source",
    instanceId: "instance.1",
    presenceEffectId: "presence.ac",
    targetActorUuid: "Actor.target"
  });
  assert.equal(plan.contract, "runtime-v1");
  assert.equal(plan.add.length, 1);
  assert.equal(plan.add[0].key, key);
  assert.deepEqual(plan.add[0].targetTokenIds, ["target-a", "target-b"]);
});

test("runtime planner suppresses actor-bound Presence when immunity reports a block", () => {
  const plan = planRuntimePresenceReconciliation({
    sceneId: "scene.1",
    aura: aura(),
    instanceId: "instance.1",
    sourceTokenId: "source",
    candidates: [{ tokenId: "target", actorUuid: "Actor.target", disposition: "enemy" }],
    activeBindings: new Set(),
    isInside: () => true,
    isPresenceBlocked: () => true
  });
  assert.equal(plan.desired.size, 0);
  assert.equal(plan.add.length, 0);
});


test("public engine planner selects runtime-v1 while retaining the explicit legacy contract", () => {
  const engine = new AuraEngineCore();
  const current = engine.planPresence({
    sceneId: "scene.1",
    aura: aura(),
    instanceId: "instance.1",
    sourceTokenId: "source",
    candidates: [{ tokenId: "target", actorUuid: "Actor.target", disposition: "enemy" }],
    activeBindings: new Set(),
    isInside: () => true
  });
  assert.equal(current.contract, "runtime-v1");

  const legacy = engine.planPresence({
    aura: aura(),
    sourceTokenId: "source",
    candidates: [{ tokenId: "target", disposition: "enemy" }],
    activeBindings: new Set(),
    isInside: () => true
  });
  assert.equal(legacy.contract, "legacy-token-v1");
  assert.equal(engine.planPresenceLegacy({
    aura: aura(),
    sourceTokenId: "source",
    candidates: [],
    activeBindings: new Set(),
    isInside: () => false
  }).contract, "legacy-token-v1");
});

test("runtime planner replaces a bound Presence effect when its Effect Definition fingerprint changes", () => {
  const currentAura = aura();
  const key = buildRuntimePresenceBindingKey({
    sceneId: "scene.1",
    sourceTokenId: "source",
    instanceId: "instance.1",
    presenceEffectId: "presence.ac",
    targetActorUuid: "Actor.target"
  });
  const plan = planRuntimePresenceReconciliation({
    sceneId: "scene.1",
    aura: currentAura,
    instanceId: "instance.1",
    sourceTokenId: "source",
    candidates: [{ tokenId: "target", actorUuid: "Actor.target", disposition: "enemy" }],
    activeBindings: new Map([[key, { effectFingerprint: JSON.stringify({ old: true }) }]]),
    isInside: () => true
  });
  assert.deepEqual(plan.remove, [{ key }]);
  assert.equal(plan.add.length, 1);
  assert.equal(plan.add[0].key, key);
});
