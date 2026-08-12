import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const css = await readFile(new URL("../styles/aura-forge.css", import.meta.url), "utf8");

test("Aura Editor owns an explicit vertical scroll pane", () => {
  assert.match(css, /\.aura-forge-scroll\s*\{[^}]*min-height:\s*0/s);
  assert.match(css, /\.aura-forge-scroll\s*\{[^}]*overflow-y:\s*auto/s);
  assert.match(css, /\.aura-forge-scroll\s*\{[^}]*scrollbar-gutter:\s*stable/s);
});

test("framed Aura Editor groups cannot be shrunk below their content by the scroll grid", () => {
  assert.match(css, /\.aura-forge-scroll\s*\{[^}]*grid-auto-rows:\s*max-content/s);
  assert.match(css, /\.aura-forge-scroll\s*\{[^}]*align-content:\s*start/s);
});

test("major framed groups do not clip fields or embedded editors", () => {
  assert.match(css, /\.aura-editor-group\s*\{[^}]*overflow:\s*visible/s);
  assert.doesNotMatch(css, /\.aura-editor-group\s*\{[^}]*overflow:\s*hidden/s);
});
