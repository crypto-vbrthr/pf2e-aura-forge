import test from "node:test";
import assert from "node:assert/strict";
import {
  AURA_FORGE_DEFAULT_WINDOW_SIZE,
  normalizeSavedWindowState,
  normalizeWindowState
} from "../scripts/ui/window-state.js";

test("Aura Forge uses the larger editor-friendly default window size", () => {
  assert.deepEqual(AURA_FORGE_DEFAULT_WINDOW_SIZE, { width: 1500, height: 960 });
});

test("legacy default window state is upgraded to the larger size", () => {
  assert.deepEqual(
    normalizeSavedWindowState({ left: 120, top: 80, width: 1240, height: 840 }),
    { left: 120, top: 80, width: 1500, height: 960 }
  );
});

test("custom saved window sizes remain untouched", () => {
  assert.deepEqual(
    normalizeSavedWindowState({ left: 20, top: 30, width: 1360, height: 900 }),
    { left: 20, top: 30, width: 1360, height: 900 }
  );
});

test("window state normalization ignores non-numeric fields", () => {
  assert.deepEqual(
    normalizeWindowState({ left: "10", top: "nope", width: 1500, height: 960, extra: 1 }),
    { left: 10, width: 1500, height: 960 }
  );
});
