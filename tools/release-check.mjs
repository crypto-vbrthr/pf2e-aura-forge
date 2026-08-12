import { readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(new URL("..", import.meta.url).pathname);
const moduleJson = JSON.parse(await readFile(resolve(root, "module.json"), "utf8"));
const packageJson = JSON.parse(await readFile(resolve(root, "package.json"), "utf8"));

if (moduleJson.id !== "pf2e-aura-forge") throw new Error("Unexpected module id.");
if (moduleJson.version !== packageJson.version) throw new Error("module.json and package.json versions differ.");
if (!moduleJson.relationships?.requires?.some((entry) => entry.id === "pf2e-critical-forge")) {
  throw new Error("PF2E Critical Forge dependency is missing.");
}
if (moduleJson.socket !== true) throw new Error("Aura Forge module socket must be enabled.");
for (const file of ["scripts/main.js", "scripts/runtime/aura-runtime-engine.js", "scripts/runtime/save-resolution-service.js", "scripts/runtime/immunity-service.js", "scripts/runtime/runtime-hooks.js", "scripts/runtime/presence-binding-service.js", "scripts/runtime/runtime-socket-service.js", "scripts/runtime/actor-data-guard.js", "templates/aura-forge-app.hbs", "styles/aura-forge.css", "lang/de.json", "lang/en.json"]) {
  await stat(resolve(root, file));
}
console.log(`release-check ok: ${moduleJson.id} ${moduleJson.version}`);
