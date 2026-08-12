import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");

function read(relative) {
  return fs.readFileSync(path.join(root, relative), "utf8");
}

test("embedded effect editors inherit the standalone Effect Forge theme scope", () => {
  const template = read("templates/aura-forge-app.hbs");
  const themedPanels = template.match(/class="[^"]*embedded-effect-inline[^"]*pf2e-critical-forge[^"]*effect-forge-panel[^"]*"/g) ?? [];

  assert.equal(themedPanels.length, 2, "presence and outcome editor panels must both use the Effect Forge theme scope");
});

test("Aura Forge does not override the embedded editor with its old neutral border/background", () => {
  const css = read("styles/aura-forge.css");
  const embeddedBlock = css.match(/\.embedded-effect-inline \{[\s\S]*?\n\}/)?.[0] ?? "";

  assert.ok(embeddedBlock.includes("min-width: 0"));
  assert.ok(!embeddedBlock.includes("--color-border-light-2"), "shared Effect Forge border must remain authoritative");
  assert.ok(!embeddedBlock.includes("rgba(127,127,127,.06)"), "shared Effect Forge panel background must remain authoritative");
});
