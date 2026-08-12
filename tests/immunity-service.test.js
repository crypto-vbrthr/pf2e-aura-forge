import test from "node:test";
import assert from "node:assert/strict";
import {
  AuraImmunityService,
  createImmunityEffectSource,
  immunityFlag,
  immunityScopeKey,
  isImmunityExpired
} from "../scripts/runtime/immunity-service.js";

function emitter(overrides = {}) {
  return {
    scene: { id: "scene" },
    sourceActor: { id: "source", uuid: "Actor.source" },
    sourceToken: { id: "source-token" },
    instance: { id: "instance.1" },
    aura: { id: "aura.fear", abilityId: "frightful-presence", name: "Fear Aura", img: "icons/svg/aura.svg" },
    ...overrides
  };
}

function trigger(scope = "ability", unit = "minutes") {
  return {
    id: "trigger.enter",
    immunity: {
      enabled: true,
      scope,
      duration: { value: 1, unit },
      applyOn: ["success"]
    }
  };
}

test("immunity scope keys distinguish instance, source, and ability semantics", () => {
  const e = emitter();
  assert.equal(immunityScopeKey({ emitter: e, immunity: { scope: "ability" } }), "ability::frightful-presence");
  assert.equal(immunityScopeKey({ emitter: e, immunity: { scope: "source" } }), "source::Actor.source::frightful-presence");
  assert.equal(immunityScopeKey({ emitter: e, immunity: { scope: "instance" } }), "instance::scene::source-token::instance.1::frightful-presence");
});

test("immunity effect source is a visible PF2e effect with the configured duration", () => {
  const source = createImmunityEffectSource({
    emitter: emitter(),
    trigger: trigger("ability", "hours"),
    targetActor: { id: "target", uuid: "Actor.target" },
    gameRef: { time: { worldTime: 500 } }
  });
  assert.equal(source.type, "effect");
  assert.equal(source.system.duration.value, 1);
  assert.equal(source.system.duration.unit, "hours");
  assert.equal(source.system.rules.length, 0);
  assert.equal(immunityFlag(source)?.scopeKey, "ability::frightful-presence");
  assert.equal(immunityFlag(source)?.expiresAtWorldTime, 4100);
});

test("world-time durations expire independently of PF2e cleanup", () => {
  const item = { flags: { "pf2e-aura-forge": { auraImmunity: { expiresAtWorldTime: 1060 } } } };
  const binding = immunityFlag(item);
  assert.equal(isImmunityExpired(item, binding, { gameRef: { time: { worldTime: 1059 } } }), false);
  assert.equal(isImmunityExpired(item, binding, { gameRef: { time: { worldTime: 1060 } } }), true);
});

test("round-based immunities defer expiry semantics to PF2e's effect duration state", () => {
  const item = { isExpired: false, flags: { "pf2e-aura-forge": { auraImmunity: { duration: { value: 1, unit: "rounds" }, expiresAtWorldTime: null } } } };
  const binding = immunityFlag(item);
  assert.equal(isImmunityExpired(item, binding, { gameRef: { time: { worldTime: 999999 } } }), false);
  item.isExpired = true;
  assert.equal(isImmunityExpired(item, binding, { gameRef: { time: { worldTime: 999999 } } }), true);
});

test("service recognizes an active matching immunity and ignores another scope key", () => {
  const e = emitter();
  const t = trigger("ability");
  const source = createImmunityEffectSource({ emitter: e, trigger: t, targetActor: { uuid: "Actor.target" }, gameRef: { time: { worldTime: 100 } } });
  const actor = { items: [source] };
  const service = new AuraImmunityService({ gameRef: { time: { worldTime: 120 } } });
  assert.equal(service.has(actor, e, t), true);
  assert.equal(service.has(actor, emitter({ aura: { ...e.aura, abilityId: "other" } }), t), false);
});

test("an applied aura immunity blocks other triggers from the same matching emitter even if they do not define immunity", () => {
  const e = emitter();
  const source = createImmunityEffectSource({
    emitter: e,
    trigger: trigger("source"),
    targetActor: { uuid: "Actor.target" },
    gameRef: { time: { worldTime: 100 } }
  });
  const actor = { items: [source] };
  const service = new AuraImmunityService({ gameRef: { time: { worldTime: 120 } } });
  assert.equal(service.hasForEmitter(actor, e), true);
  assert.equal(service.hasForEmitter(actor, emitter({ sourceActor: { id: "other", uuid: "Actor.other" } })), false);
});
