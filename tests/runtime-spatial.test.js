import test from "node:test";
import assert from "node:assert/strict";
import { auraContainsToken, tokenDistance } from "../scripts/runtime/spatial-service.js";

function token(id, x, { width = 1, hidden = false } = {}) {
  return { id, x, y: 0, width, height: 1, hidden };
}
const scene = { grid: { size: 100, distance: 5 } };

test("fallback distance measures from token edges in scene units", () => {
  const source = token("s", 0);
  const target = token("t", 200);
  assert.equal(tokenDistance(source, target, { scene }), 5);
  assert.equal(auraContainsToken(source, target, 5, { scene }), true);
  assert.equal(auraContainsToken(source, target, 4, { scene }), false);
});

test("source token is inside its own aura and hidden tokens are excluded", () => {
  const source = token("s", 0);
  assert.equal(auraContainsToken(source, source, 0, { scene }), true);
  assert.equal(auraContainsToken(source, token("h", 0, { hidden: true }), 30, { scene }), false);
});

test("PF2e token placeable distanceTo is preferred when available", () => {
  const source = token("s", 0);
  const target = token("t", 500);
  source.object = { distanceTo: () => 7 };
  target.object = {};
  assert.equal(tokenDistance(source, target, { scene }), 7);
  assert.equal(auraContainsToken(source, target, 10, { scene }), true);
});


test("animated PF2e placeables use updated TokenDocument coordinates instead of stale canvas positions", () => {
  const source = token("s", 0);
  const target = token("t", 200);
  source.object = { distanceTo: () => 100, animation: Promise.resolve() };
  target.object = {};
  // Document coordinates put the tokens 5 ft apart. The stale canvas distance
  // deliberately claims 100 ft and must not win while animation is active.
  assert.equal(tokenDistance(source, target, { scene }), 5);
  assert.equal(auraContainsToken(source, target, 10, { scene }), true);
});
