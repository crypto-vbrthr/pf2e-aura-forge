import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../scripts/ui/aura-forge-app.js", import.meta.url), "utf8");
const templateSource = await readFile(new URL("../templates/aura-forge-app.hbs", import.meta.url), "utf8");

test("Aura Forge consumes only the public Effect Forge editor API", () => {
  assert.match(source, /api\.ui\.effectEditor\.createSession/);
  assert.match(source, /api\.ui\.effectEditor\.create/);
  assert.doesNotMatch(source, /pf2e-critical-forge\/scripts/);
});

test("save and library actions remain owned by the Aura Forge container", () => {
  assert.match(source, /static async saveAura/);
  assert.match(source, /repository\.upsert/);
  assert.match(source, /static async duplicateAura/);
  assert.match(source, /static async deleteAura/);
});


test("embedded Effect Editor is rendered inline with the selected aura effect", () => {
  assert.match(templateSource, /presence\.isEditing/);
  assert.match(templateSource, /outcome\.isEditing/);
  assert.match(templateSource, /data-embedded-effect-editor/);
  assert.doesNotMatch(templateSource, /hasActiveEffectEditor/);
});

test("Aura Forge preserves its scroll containers across action rerenders", () => {
  assert.match(source, /captureScrollState/);
  assert.match(source, /restoreScrollState/);
  assert.match(source, /#renderPreservingScroll/);
  assert.match(templateSource, /data-scroll-key="main"/);
  assert.match(templateSource, /data-scroll-key="library"/);
});


test("trigger form synchronization scopes itself to trigger cards, not nested action buttons", () => {
  assert.match(source, /querySelectorAll\("\.trigger-card\[data-trigger-id\]"\)/);
  assert.doesNotMatch(source, /for \(const card of container\.querySelectorAll\("\[data-trigger-id\]"\)\)/);
});


test("temporary immunity exposes an explicit presence-suppression option", () => {
  assert.match(templateSource, /name="immunityBlocksPresence"/);
  assert.match(source, /trigger\.immunity\.blocksPresence/);
});

test("presence-blocking immunity explains immediate removal and later restoration semantics", () => {
  assert.match(templateSource, /data-immunity-presence-hint/);
  assert.match(source, /presenceInteractionHint/);
  assert.match(source, /immunityBlocksPresence/);
});
