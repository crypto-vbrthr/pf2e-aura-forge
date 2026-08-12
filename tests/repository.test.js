import test from "node:test";
import assert from "node:assert/strict";
import { AuraRepository } from "../scripts/aura/aura-repository.js";
import { createAuraDefinition } from "../scripts/aura/aura-definition.js";

function memoryStorage(initial = null) {
  let value = structuredClone(initial);
  return {
    async get() { return structuredClone(value); },
    async set(next) { value = structuredClone(next); },
    snapshot() { return structuredClone(value); }
  };
}

test("repository upserts and reads isolated copies", async () => {
  const storage = memoryStorage();
  const repo = new AuraRepository(storage);
  const aura = createAuraDefinition({ id: "aura.one", name: "One" });
  await repo.upsert(aura);
  const loaded = await repo.get("aura.one");
  assert.equal(loaded.name, "One");
  loaded.name = "Mutated";
  assert.equal((await repo.get("aura.one")).name, "One");
});

test("repository preserves unknown library metadata", async () => {
  const storage = memoryStorage({ storageVersion: 1, custom: { x: 1 }, auras: [] });
  const repo = new AuraRepository(storage);
  await repo.upsert(createAuraDefinition({ id: "aura.one", name: "One" }));
  assert.deepEqual(storage.snapshot().custom, { x: 1 });
});

test("repository duplicate creates a separate aura", async () => {
  const repo = new AuraRepository(memoryStorage());
  await repo.upsert(createAuraDefinition({ id: "aura.one", name: "One" }));
  const duplicate = await repo.duplicate("aura.one", { nameSuffix: " Copy" });
  assert.notEqual(duplicate.id, "aura.one");
  assert.equal(duplicate.name, "One Copy");
  assert.equal((await repo.list()).length, 2);
});

test("repository remove reports whether an aura existed", async () => {
  const repo = new AuraRepository(memoryStorage());
  await repo.upsert(createAuraDefinition({ id: "aura.one", name: "One" }));
  assert.equal(await repo.remove("aura.one"), true);
  assert.equal(await repo.remove("aura.one"), false);
});
