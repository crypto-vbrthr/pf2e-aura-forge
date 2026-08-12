import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { MODULE_VERSION } from "../scripts/constants.js";

test("module manifest and compiled module version stay aligned", async () => {
  const manifest = JSON.parse(await readFile(new URL("../module.json", import.meta.url), "utf8"));
  assert.equal(manifest.version, MODULE_VERSION);
  assert.equal(manifest.socket, true);
});

test("ready hook contains a mixed-install fail-fast guard", async () => {
  const source = await readFile(new URL("../scripts/main.js", import.meta.url), "utf8");
  assert.match(source, /Mixed installation detected/);
  assert.match(source, /manifestVersion !== MODULE_VERSION/);
});
