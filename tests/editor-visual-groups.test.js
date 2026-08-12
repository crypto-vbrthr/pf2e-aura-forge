import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const template = await readFile(new URL("../templates/aura-forge-app.hbs", import.meta.url), "utf8");
const css = await readFile(new URL("../styles/aura-forge.css", import.meta.url), "utf8");

test("Aura Editor exposes distinct semantic groups for its major domains", () => {
  for (const className of [
    "group-basic-data",
    "group-targeting",
    "group-actor-assignment",
    "group-presence-effects",
    "group-triggers",
  ]) {
    assert.match(template, new RegExp(`class="[^"]*${className}[^"]*"`));
  }
});

test("major Aura Editor groups use strong theme-safe framed title rails", () => {
  assert.match(css, /\.pf2e-aura-forge\s*\{[^}]*--aura-frame-border:\s*color-mix/s);
  assert.match(css, /\.aura-editor-group\s*\{[^}]*border:\s*2px\s+solid/s);
  assert.match(css, /\.aura-editor-group\s*\{[^}]*border-left:\s*5px\s+solid\s+var\(--aura-frame-accent/s);
  assert.match(css, /\.aura-editor-group > \.section-titlebar\s*\{[^}]*background:/s);
  assert.match(css, /\.aura-editor-group > \.section-titlebar/);
  assert.match(css, /\.section-heading-icon\s*\{/);
});

test("major group framing has concrete fallbacks instead of depending on legacy Foundry border variables", () => {
  assert.match(css, /border:\s*2px\s+solid\s+rgba\(/);
  assert.match(css, /--aura-frame-accent:\s*var\(--color-warm-2,\s*var\(--color-border-highlight,\s*#[0-9a-fA-F]{6}\)\)/);
  assert.doesNotMatch(css, /\.aura-editor-group\s*\{[^}]*border-color:\s*var\(--color-border-light-2\)/s);
});

test("visual grouping does not replace the Effect Forge theme scope", () => {
  assert.match(template, /pf2e-critical-forge effect-forge-panel/);
  assert.doesNotMatch(css, /\.embedded-effect-inline\s*\{[^}]*border-left-color/s);
});
