import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const appSource = await readFile(new URL("../scripts/ui/aura-forge-app.js", import.meta.url), "utf8");
const editorSource = await readFile(new URL("../scripts/ui/aura-editor.js", import.meta.url), "utf8");
const appTemplate = await readFile(new URL("../templates/aura-forge-app.hbs", import.meta.url), "utf8");
const editorTemplate = await readFile(new URL("../templates/aura-editor.hbs", import.meta.url), "utf8");
const apiSource = await readFile(new URL("../scripts/api/public-api.js", import.meta.url), "utf8");

test("Aura Editor consumes only the public Effect Forge editor API", () => {
  assert.match(editorSource, /api\.ui\.effectEditor\.createSession/);
  assert.match(editorSource, /api\.ui\.effectEditor\.create/);
  assert.doesNotMatch(editorSource, /pf2e-critical-forge\/scripts/);
});

test("standalone Aura Forge is a container around the shared embedded Aura Editor", () => {
  assert.match(appSource, /createAuraEditorSession/);
  assert.match(appSource, /createEmbeddedAuraEditor/);
  assert.match(appSource, /this\.auraEditor\.mount/);
  assert.match(appTemplate, /data-aura-editor-host/);
  assert.doesNotMatch(appTemplate, /name="auraName"/);
});

test("save, library, and actor assignment actions remain owned by the Aura Forge container", () => {
  assert.match(appSource, /static async saveAura/);
  assert.match(appSource, /repository\.upsert/);
  assert.match(appSource, /static async duplicateAura/);
  assert.match(appSource, /static async deleteAura/);
  assert.match(appSource, /static async assignAura/);
  assert.match(appTemplate, /data-instance-controls/);
  assert.doesNotMatch(editorTemplate, /data-instance-controls/);
});

test("public API exposes the shared Aura Editor additively", () => {
  assert.match(apiSource, /createAuraEditorUiApi/);
  assert.match(apiSource, /auraEditor:\s*createAuraEditorUiApi\(\)/);
  assert.match(editorSource, /createSession:/);
  assert.match(editorSource, /create:/);
  assert.match(editorSource, /render:/);
  assert.match(editorSource, /prepareContext:/);
});

test("embedded Effect Editor is rendered inline inside the shared Aura Editor", () => {
  assert.match(editorTemplate, /presence\.isEditing/);
  assert.match(editorTemplate, /outcome\.isEditing/);
  assert.match(editorTemplate, /data-embedded-effect-editor/);
});

test("Aura Forge preserves its scroll containers across container rerenders", () => {
  assert.match(appSource, /captureScrollState/);
  assert.match(appSource, /restoreScrollState/);
  assert.match(appSource, /#renderPreservingScroll/);
  assert.match(appTemplate, /data-scroll-key="main"/);
  assert.match(appTemplate, /data-scroll-key="library"/);
});

test("trigger form synchronization scopes itself to trigger cards, not nested action buttons", () => {
  assert.match(editorSource, /querySelectorAll\("\.trigger-card\[data-trigger-id\]"\)/);
  assert.doesNotMatch(editorSource, /for \(const card of root\.querySelectorAll\("\[data-trigger-id\]"\)\)/);
});

test("temporary immunity exposes an explicit presence-suppression option", () => {
  assert.match(editorTemplate, /name="immunityBlocksPresence"/);
  assert.match(editorSource, /trigger\.immunity\.blocksPresence/);
});

test("presence-blocking immunity explains immediate removal and later restoration semantics", () => {
  assert.match(editorTemplate, /data-immunity-presence-hint/);
  assert.match(editorSource, /presenceInteractionHint/);
  assert.match(editorSource, /immunityBlocksPresence/);
});

test("duplicate action validates the current embedded Aura draft before writing a copy", async () => {
  const source = await readFile(new URL("../scripts/ui/aura-forge-app.js", import.meta.url), "utf8");
  const duplicateBody = source.slice(source.indexOf("static async duplicateAura"), source.indexOf("static async deleteAura"));
  assert.match(duplicateBody, /this\.auraEditor\.validate\(\)/);
  assert.match(duplicateBody, /if \(!validation\.valid\)/);
  assert.match(duplicateBody, /repository\.upsert\(copy\)/);
  assert.ok(duplicateBody.indexOf("auraEditor.validate()") < duplicateBody.indexOf("repository.upsert(copy)"));
});

test("public API exposes Actor-local Aura Definition assignment for generator integrations", () => {
  assert.match(apiSource, /instanceSchemaVersion:\s*AURA_INSTANCE_SCHEMA_VERSION/);
  assert.match(apiSource, /assignDefinition:\s*\(actor, definition/);
  assert.match(apiSource, /updateDefinition:\s*\(actor, instanceId, definition/);
});
