import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
const source = await readFile(new URL("../scripts/ui/aura-forge-app.js", import.meta.url), "utf8");
const template = await readFile(new URL("../templates/aura-forge-app.hbs", import.meta.url), "utf8");
const main = await readFile(new URL("../scripts/main.js", import.meta.url), "utf8");

test("Aura Forge exposes assignment, enable, radius override, and removal controls", () => {
  for (const action of ["assignAura","assignSelectedToken","toggleActorAura","updateRadiusOverride","removeActorAura"]) {
    assert.match(source, new RegExp(`static async ${action}`));
    assert.match(template, new RegExp(`data-action=\\"${action}\\"`));
  }
});

test("actor instance controls stay outside the shared Aura Editor draft", async () => {
  const editorTemplate = await readFile(new URL("../templates/aura-editor.hbs", import.meta.url), "utf8");
  assert.match(template, /data-instance-controls/);
  assert.match(template, /data-aura-editor-host/);
  assert.doesNotMatch(editorTemplate, /data-instance-controls/);
});

test("Actor Assignment supports directory drag and drop", () => {
  assert.match(template, /data-actor-drop-zone/);
  assert.match(source, /#setupActorDropZone/);
  assert.match(source, /addEventListener\("dragover"/);
  assert.match(source, /addEventListener\("drop"/);
  assert.match(source, /getDragEventData/);
  assert.match(source, /fromUuid/);
});

test("ready reconciliation upgrades existing flag-only assignments", () => {
  assert.match(main, /instances\?\.reconcileAll/);
});
