import test from "node:test";
import assert from "node:assert/strict";
import { emitterRuntimeKey, planOccupancyTransitions } from "../scripts/runtime/runtime-transitions.js";

test("occupancy planner returns enter and leave transitions", () => {
  const result = planOccupancyTransitions(new Set(["a", "b"]), new Set(["b", "c"]));
  assert.deepEqual(result.entered, ["c"]);
  assert.deepEqual(result.left, ["a"]);
});

test("emitter key is scene/token/instance stable", () => {
  assert.equal(emitterRuntimeKey("scene", "token", "inst"), "scene::token::inst");
});
