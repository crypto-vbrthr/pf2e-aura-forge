import test from "node:test";
import assert from "node:assert/strict";
import {
  ACTOR_AURA_FLAG,
  AURA_ABILITY_FLAG,
  ActorAuraService,
  createAuraAbilitySource
} from "../scripts/actor/actor-aura-service.js";
import { createAuraDefinition } from "../scripts/aura/aura-definition.js";

function setByPath(target, path, value) {
  const parts = path.split(".");
  let current = target;
  for (const part of parts.slice(0, -1)) current = current[part] ??= {};
  current[parts.at(-1)] = structuredClone(value);
}

class MockItem {
  constructor(source, id) {
    this.id = id;
    Object.assign(this, structuredClone(source));
  }
  getFlag(scope, key) { return this.flags?.[scope]?.[key]; }
}

class MockActor {
  constructor(id, name) {
    this.id=id;
    this.name=name;
    this.flags={};
    this.items=[];
    this.nextItemId=1;
    this.createCalls=0;
    this.updateCalls=0;
    this.deleteCalls=0;
  }
  getFlag(scope, key) { return this.flags?.[scope]?.[key]; }
  async setFlag(scope, key, value) { this.flags[scope] ??= {}; this.flags[scope][key] = structuredClone(value); }
  async createEmbeddedDocuments(type, sources) {
    assert.equal(type, "Item");
    this.createCalls += 1;
    const created = sources.map((source) => {
      const item = new MockItem(source, `item.${this.nextItemId++}`);
      this.items.push(item);
      return item;
    });
    return created;
  }
  async updateEmbeddedDocuments(type, updates) {
    assert.equal(type, "Item");
    this.updateCalls += 1;
    return updates.map((update) => {
      const item = this.items.find((entry) => entry.id === update._id);
      assert.ok(item);
      for (const [key, value] of Object.entries(update)) {
        if (key === "_id") continue;
        if (key.includes(".")) setByPath(item, key, value);
        else item[key] = structuredClone(value);
      }
      return item;
    });
  }
  async deleteEmbeddedDocuments(type, ids) {
    assert.equal(type, "Item");
    this.deleteCalls += 1;
    this.items = this.items.filter((item) => !ids.includes(item.id));
    return ids;
  }
}

function library(definitions) {
  const map = new Map(definitions.map((x) => [x.id, structuredClone(x)]));
  return {
    map,
    async get(id) { return structuredClone(map.get(id) ?? null); },
    set(definition) { map.set(definition.id, structuredClone(definition)); }
  };
}

function auraAbility(actor, instanceId) {
  return actor.items.find((item) => item.getFlag("pf2e-aura-forge", AURA_ABILITY_FLAG)?.instanceId === instanceId);
}

test("Aura Forge actor proxies are passive PF2e abilities", () => {
  const aura = createAuraDefinition({ id: "aura.one", name: "Weakening Aura", description: "A nearby foe is weakened." });
  const source = createAuraAbilitySource(aura, { id: "inst.1", definitionId: aura.id, definitionName: aura.name });
  assert.equal(source.type, "action");
  assert.equal(source.system.actionType.value, "passive");
  assert.equal(source.system.actions.value, null);
  assert.equal(source.system.category, "interaction");
  assert.deepEqual(source.system.traits.value, ["aura"]);
  assert.equal(source.system.rules.length, 1);
  assert.equal(source.system.rules[0].key, "Aura");
  assert.equal(source.system.rules[0].radius, aura.radius);
  assert.deepEqual(source.system.rules[0].effects, []);
  assert.equal(source.system.description.value, aura.description);
  assert.equal(source.flags["pf2e-aura-forge"][AURA_ABILITY_FLAG].instanceId, "inst.1");
});

test("assign stores one lightweight instance and creates one sheet-visible ability", async () => {
  const aura = createAuraDefinition({ id: "aura.one", name: "One", radius: 30 });
  const actor = new MockActor("actor.1", "Hero");
  const service = new ActorAuraService({ library: library([aura]) });
  const first = await service.assign(actor, aura.id);
  const second = await service.assign(actor, aura.id);
  assert.equal(first.id, second.id);
  assert.equal(service.list(actor).length, 1);
  assert.equal(service.list(actor)[0].definitionId, aura.id);
  assert.equal(actor.items.length, 1);
  assert.equal(auraAbility(actor, first.id).name, "One");
});

test("instances can be toggled, overridden, resolved, and removed with their ability proxy", async () => {
  const aura = createAuraDefinition({ id: "aura.one", name: "One", radius: 30 });
  const actor = new MockActor("actor.1", "Hero");
  const service = new ActorAuraService({ library: library([aura]) });
  const instance = await service.assign(actor, aura.id);
  await service.setEnabled(actor, instance.id, false);
  await service.setRadiusOverride(actor, instance.id, 20);
  const report = await service.resolve(actor, instance.id);
  assert.equal(report.resolved.enabled, false);
  assert.equal(report.resolved.radius, 20);
  assert.equal(await service.remove(actor, instance.id), true);
  assert.equal(service.list(actor).length, 0);
  assert.equal(actor.items.length, 0);
});

test("definition cleanup removes actor flags and matching ability proxies", async () => {
  const aura = createAuraDefinition({ id: "aura.one", name: "One" });
  const other = createAuraDefinition({ id: "aura.two", name: "Two" });
  const actors = [new MockActor("a", "A"), new MockActor("b", "B")];
  const service = new ActorAuraService({ library: library([aura, other]) });
  await service.assign(actors[0], aura.id);
  await service.assign(actors[0], other.id);
  await service.assign(actors[1], aura.id);
  assert.equal(await service.removeDefinitionReferences(aura.id, actors), 2);
  assert.deepEqual(service.list(actors[0]).map((x)=>x.definitionId), [other.id]);
  assert.equal(service.list(actors[1]).length, 0);
  assert.equal(actors[0].items.length, 1);
  assert.equal(actors[0].items[0].name, "Two");
  assert.equal(actors[1].items.length, 0);
});

test("reconcileActor upgrades legacy flag-only assignments to passive abilities", async () => {
  const aura = createAuraDefinition({ id: "aura.one", name: "Legacy Aura" });
  const actor = new MockActor("actor.1", "Hero");
  const service = new ActorAuraService({ library: library([aura]) });
  const legacyInstance = {
    schemaVersion: 1,
    id: "legacy.instance",
    definitionId: aura.id,
    definitionName: aura.name,
    enabled: true,
    overrides: { radius: null }
  };
  await actor.setFlag("pf2e-aura-forge", ACTOR_AURA_FLAG, [legacyInstance]);
  assert.equal(actor.items.length, 0);
  const report = await service.reconcileActor(actor);
  assert.equal(report.synced, 1);
  assert.equal(actor.items.length, 1);
  assert.equal(actor.items[0].name, "Legacy Aura");
});

test("syncDefinition keeps actor ability names and descriptions in step with the central template", async () => {
  const aura = createAuraDefinition({ id: "aura.one", name: "Old Name", description: "Old text" });
  const repo = library([aura]);
  const actor = new MockActor("actor.1", "Hero");
  const service = new ActorAuraService({ library: repo });
  const instance = await service.assign(actor, aura.id);
  repo.set({ ...aura, name: "New Name", description: "New text" });
  assert.equal(await service.syncDefinition(aura.id, [actor]), 1);
  const ability = auraAbility(actor, instance.id);
  assert.equal(ability.name, "New Name");
  assert.equal(ability.system.description.value, "New text");
});


test("actor proxy native Aura rule follows enabled state and radius overrides", async () => {
  const aura = createAuraDefinition({ id: "aura.visual", name: "Visible Aura", radius: 15 });
  const actor = new MockActor("actor.visual", "Aura Bearer");
  const service = new ActorAuraService({ library: library([aura]) });
  const instance = await service.assign(actor, aura.id);
  let ability = auraAbility(actor, instance.id);
  assert.deepEqual(ability.system.traits.value, ["aura"]);
  assert.equal(ability.system.rules[0].key, "Aura");
  assert.equal(ability.system.rules[0].radius, 15);

  await service.setRadiusOverride(actor, instance.id, 30);
  ability = auraAbility(actor, instance.id);
  assert.equal(ability.system.rules[0].radius, 30);

  await service.setEnabled(actor, instance.id, false);
  ability = auraAbility(actor, instance.id);
  assert.deepEqual(ability.system.rules, []);
  assert.deepEqual(ability.system.traits.value, ["aura"]);

  await service.setEnabled(actor, instance.id, true);
  ability = auraAbility(actor, instance.id);
  assert.equal(ability.system.rules[0].radius, 30);
});


test("reconcileActor is idempotent and performs no Item update when the proxy is already current", async () => {
  const aura = createAuraDefinition({ id: "aura.idempotent", name: "Stable Aura", description: "No churn" });
  const actor = new MockActor("actor.idempotent", "Hero");
  const service = new ActorAuraService({ library: library([aura]) });
  await service.assign(actor, aura.id);
  const beforeUpdates = actor.updateCalls;
  const beforeCreates = actor.createCalls;

  const report = await service.reconcileActor(actor);

  assert.equal(report.synced, 0);
  assert.equal(report.unchanged, 1);
  assert.equal(actor.updateCalls, beforeUpdates);
  assert.equal(actor.createCalls, beforeCreates);
});

test("automatic proxy reconciliation is single-writer across clients", async () => {
  const aura = createAuraDefinition({ id: "aura.writer", name: "Writer Aura" });
  const actor = new MockActor("actor.writer", "Hero");
  const writer = { id: "gm-a", isGM: true, active: true };
  const other = { id: "gm-b", isGM: true, active: true };
  actor.primaryUpdater = { id: "gm-a", isGM: true, active: true };
  await actor.setFlag("pf2e-aura-forge", ACTOR_AURA_FLAG, [{
    schemaVersion: 1,
    id: "instance.writer",
    definitionId: aura.id,
    definitionName: aura.name,
    enabled: true,
    overrides: { radius: null }
  }]);

  const repo = library([aura]);
  const nonWriter = new ActorAuraService({ library: repo, gameRef: { user: other, users: { contents: [writer, other], activeGM: writer } } });
  const actualWriter = new ActorAuraService({ library: repo, gameRef: { user: writer, users: { contents: [writer, other], activeGM: writer } } });

  const skipped = await nonWriter.reconcileActor(actor);
  assert.equal(skipped.skippedWriter, true);
  assert.equal(actor.items.length, 0);

  const synced = await actualWriter.reconcileActor(actor);
  assert.equal(synced.skippedWriter, false);
  assert.equal(synced.synced, 1);
  assert.equal(actor.items.length, 1);
});

test("radius overrides reject zero, negative, and non-finite values", async () => {
  const aura = createAuraDefinition({ id: "aura.radius-contract", name: "Radius Aura", radius: 15 });
  const actor = new MockActor("actor.radius", "Hero");
  const service = new ActorAuraService({ library: library([aura]) });
  const instance = await service.assign(actor, aura.id);

  await assert.rejects(() => service.setRadiusOverride(actor, instance.id, 0), RangeError);
  await assert.rejects(() => service.setRadiusOverride(actor, instance.id, -5), RangeError);
  await assert.rejects(() => service.setRadiusOverride(actor, instance.id, Number.NaN), RangeError);
  const cleared = await service.setRadiusOverride(actor, instance.id, null);
  assert.equal(cleared.overrides.radius, null);
});

test("assignDefinition stores an Actor-local aura snapshot without touching the central library", async () => {
  const repo = library([]);
  const actor = new MockActor("actor.local", "Generated Creature");
  const service = new ActorAuraService({ library: repo });
  const aura = createAuraDefinition({ id: "aura.generated", name: "Generated Aura", description: "Actor owned", radius: 20 });

  const instance = await service.assignDefinition(actor, aura);

  assert.equal(instance.definitionScope, "actor");
  assert.equal(instance.definitionId, aura.id);
  assert.equal(instance.definitionSnapshot.name, "Generated Aura");
  assert.equal(repo.map.size, 0);
  assert.equal(actor.items.length, 1);
  assert.equal(actor.items[0].name, "Generated Aura");
  const resolved = await service.resolve(actor, instance.id);
  assert.equal(resolved.missingDefinition, false);
  assert.equal(resolved.definitionScope, "actor");
  assert.equal(resolved.resolved.radius, 20);
});

test("reassigning and updating an Actor-local definition refreshes its snapshot and passive proxy", async () => {
  const actor = new MockActor("actor.local-update", "Generated Creature");
  const service = new ActorAuraService({ library: library([]) });
  const aura = createAuraDefinition({ id: "aura.generated", name: "First Name", description: "First" });
  const instance = await service.assignDefinition(actor, aura);

  const reassigned = await service.assignDefinition(actor, { ...aura, name: "Second Name", description: "Second" });
  assert.equal(reassigned.id, instance.id);
  assert.equal(service.list(actor).length, 1);
  assert.equal(auraAbility(actor, instance.id).name, "Second Name");

  const updated = await service.updateDefinition(actor, instance.id, { ...aura, name: "Third Name", description: "Third" });
  assert.equal(updated.definitionSnapshot.name, "Third Name");
  assert.equal(auraAbility(actor, instance.id).name, "Third Name");
  assert.equal(auraAbility(actor, instance.id).system.description.value, "Third");
});

test("Actor-local definitions survive central library sync and deletion even when ids collide", async () => {
  const libraryAura = createAuraDefinition({ id: "aura.shared", name: "Library Aura", description: "Central" });
  const repo = library([libraryAura]);
  const actor = new MockActor("actor.scope", "Scoped Creature");
  const service = new ActorAuraService({ library: repo });

  const libraryInstance = await service.assign(actor, libraryAura.id);
  const localInstance = await service.assignDefinition(actor, { ...libraryAura, name: "Local Aura", description: "Snapshot" });
  assert.equal(service.list(actor).length, 2);

  repo.set({ ...libraryAura, name: "Updated Library Aura", description: "Updated central" });
  assert.equal(await service.syncDefinition(libraryAura.id, [actor]), 1);
  assert.equal(auraAbility(actor, libraryInstance.id).name, "Updated Library Aura");
  assert.equal(auraAbility(actor, localInstance.id).name, "Local Aura");

  assert.equal(await service.removeDefinitionReferences(libraryAura.id, [actor]), 1);
  const remaining = service.list(actor);
  assert.equal(remaining.length, 1);
  assert.equal(remaining[0].id, localInstance.id);
  assert.equal(remaining[0].definitionScope, "actor");
  assert.equal(auraAbility(actor, localInstance.id).name, "Local Aura");
});

test("reconcileActor restores Actor-local aura proxies without a library definition", async () => {
  const aura = createAuraDefinition({ id: "aura.local-reconcile", name: "Local Reconcile" });
  const actor = new MockActor("actor.local-reconcile", "Generated Creature");
  const service = new ActorAuraService({ library: library([]) });
  const instance = await service.assignDefinition(actor, aura);
  actor.items = [];

  const report = await service.reconcileActor(actor);
  assert.equal(report.synced, 1);
  assert.equal(actor.items.length, 1);
  assert.equal(auraAbility(actor, instance.id).name, "Local Reconcile");
});

test("updateDefinition rejects central-library assignments and identity changes", async () => {
  const aura = createAuraDefinition({ id: "aura.central", name: "Central" });
  const actor = new MockActor("actor.contract", "Contract Creature");
  const service = new ActorAuraService({ library: library([aura]) });
  const central = await service.assign(actor, aura.id);
  await assert.rejects(
    () => service.updateDefinition(actor, central.id, aura),
    (error) => error?.code === "AURA_INSTANCE_NOT_ACTOR_LOCAL"
  );

  const local = await service.assignDefinition(actor, createAuraDefinition({ id: "aura.local", name: "Local" }));
  await assert.rejects(
    () => service.updateDefinition(actor, local.id, createAuraDefinition({ id: "aura.changed", name: "Changed" })),
    (error) => error?.code === "AURA_DEFINITION_ID_IMMUTABLE"
  );
});
