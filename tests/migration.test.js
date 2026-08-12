import test from "node:test";
import assert from "node:assert/strict";
import { migrateAuraDefinition, AuraMigrationError } from "../scripts/aura/aura-migrations.js";

test("legacy v0 aliases migrate to schema v1", () => {
  const result = migrateAuraDefinition({
    id: "legacy.aura",
    name: "Legacy",
    distance: 20,
    continuousEffects: [],
    eventEffects: []
  });
  assert.equal(result.migrated, true);
  assert.equal(result.definition.schemaVersion, 1);
  assert.equal(result.definition.radius, 20);
  assert.deepEqual(result.definition.presenceEffects, []);
  assert.deepEqual(result.definition.triggers, []);
  assert.equal("distance" in result.definition, false);
});

test("current definitions normalize without a migration step", () => {
  const result = migrateAuraDefinition({ schemaVersion: 1, id: "a", name: "A", radius: 10 });
  assert.equal(result.migrated, false);
  assert.deepEqual(result.steps, []);
});

test("future schema versions are rejected", () => {
  assert.throws(() => migrateAuraDefinition({ schemaVersion: 99 }), (error) => {
    assert.ok(error instanceof AuraMigrationError);
    assert.equal(error.code, "AURA_SCHEMA_VERSION_FUTURE");
    return true;
  });
});
