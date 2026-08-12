import test from "node:test";
import assert from "node:assert/strict";
import {
  PRESENCE_BINDING_METADATA,
  PresenceBindingService,
  createPresenceBinding,
  preparePresenceEffect,
  presenceBindingFlag
} from "../scripts/runtime/presence-binding-service.js";

function desiredPresence() {
  return {
    key: "scene::source::instance::presence::Actor.target",
    sceneId: "scene",
    auraId: "aura.test",
    instanceId: "instance.test",
    presenceEffectId: "presence.test",
    sourceActorUuid: "Actor.source",
    sourceTokenId: "source-token",
    targetActorUuid: "Actor.target",
    targetTokenIds: ["target-token"],
    effectFingerprint: "fingerprint",
    effect: {
      schemaVersion: 2,
      id: "effect.test",
      name: "Presence Test",
      duration: { value: 1, unit: "rounds", expiry: "turn-end" },
      metadata: { customKey: "keep-me" },
      components: [{ type: "modifier", selector: "ac", value: -1, modifierType: "status" }]
    }
  };
}

test("presence effect stores its binding in Critical Forge Effect Definition metadata before application", () => {
  const desired = desiredPresence();
  const binding = createPresenceBinding(desired);
  const prepared = preparePresenceEffect(desired.effect, binding);

  assert.deepEqual(prepared.metadata[PRESENCE_BINDING_METADATA], binding);
  assert.equal(prepared.metadata.customKey, "keep-me");
  assert.deepEqual(prepared.duration, { value: -1, unit: "unlimited", expiry: null });
});

test("presence binding is read from the persisted Critical Forge definition metadata", () => {
  const desired = desiredPresence();
  const binding = createPresenceBinding(desired);
  const item = {
    flags: {
      "pf2e-critical-forge": {
        definition: {
          metadata: {
            [PRESENCE_BINDING_METADATA]: binding
          }
        }
      }
    }
  };

  assert.deepEqual(presenceBindingFlag(item), binding);
});

test("PresenceBindingService applies one already-tagged definition and performs no post-create item flag mutation", async () => {
  const desired = desiredPresence();
  const actor = { id: "target" };
  const item = {
    setFlag() {
      throw new Error("presence binding must not be added with a post-create setFlag call");
    }
  };
  const calls = [];
  const service = new PresenceBindingService({
    effectApi: {
      effects: {
        async apply(definition, target, options) {
          calls.push({ definition, target, options });
          return [item];
        }
      }
    }
  });

  const result = await service.apply(actor, desired);
  assert.deepEqual(result, [item]);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].target, actor);
  assert.equal(
    calls[0].definition.metadata[PRESENCE_BINDING_METADATA].key,
    desired.key
  );
});

test("legacy Aura Forge presenceBinding flags remain readable for cleanup", () => {
  const binding = { key: "legacy" };
  const item = {
    getFlag(scope, key) {
      return scope === "pf2e-aura-forge" && key === "presenceBinding" ? binding : null;
    }
  };
  assert.equal(presenceBindingFlag(item), binding);
});
