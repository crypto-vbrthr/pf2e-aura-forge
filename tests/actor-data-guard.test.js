import test from "node:test";
import assert from "node:assert/strict";
import {
  malformedPhysicalDescriptionItems,
  repairMalformedPhysicalDescriptions
} from "../scripts/runtime/actor-data-guard.js";

test("detects only physical PF2e items whose description object is completely missing", () => {
  const broken = { id: "broken", type: "equipment", _source: { system: {} } };
  const healthy = { id: "healthy", type: "equipment", _source: { system: { description: { value: "ok" } } } };
  const action = { id: "action", type: "action", _source: { system: {} } };
  const actor = { items: [broken, healthy, action] };

  assert.deepEqual(malformedPhysicalDescriptionItems(actor).map((item) => item.id), ["broken"]);
});

test("repairs missing physical-item description data before later Actor embedded mutations", async () => {
  const broken = { id: "broken", type: "equipment", _source: { system: {} } };
  const updates = [];
  const actor = {
    id: "actor",
    uuid: "Actor.actor",
    items: [broken],
    async updateEmbeddedDocuments(type, changes, options) {
      updates.push({ type, changes: structuredClone(changes), options: structuredClone(options) });
      broken._source.system.description = structuredClone(changes[0]["system.description"]);
      return [broken];
    }
  };

  const report = await repairMalformedPhysicalDescriptions(actor, { logger: null });
  assert.equal(report.repaired, 1);
  assert.deepEqual(report.itemIds, ["broken"]);
  assert.equal(updates.length, 1);
  assert.equal(updates[0].type, "Item");
  assert.deepEqual(updates[0].changes[0]["system.description"], { value: "", gm: "" });
  assert.deepEqual(broken._source.system.description, { value: "", gm: "" });
});
