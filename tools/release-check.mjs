import { readFile, stat, readdir } from "node:fs/promises";
import { resolve, extname } from "node:path";
import { MODULE_VERSION, API_VERSION, AURA_SCHEMA_VERSION, AURA_INSTANCE_SCHEMA_VERSION } from "../scripts/constants.js";

const root = resolve(new URL("..", import.meta.url).pathname);
const readJson = async (file) => JSON.parse(await readFile(resolve(root, file), "utf8"));
const moduleJson = await readJson("module.json");
const packageJson = await readJson("package.json");

if (moduleJson.id !== "pf2e-aura-forge") throw new Error("Unexpected module id.");
if (moduleJson.version !== packageJson.version) throw new Error("module.json and package.json versions differ.");
if (moduleJson.version !== MODULE_VERSION) throw new Error("Manifest/package version differs from runtime MODULE_VERSION.");
if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(moduleJson.version)) throw new Error("Module version is not release-semver shaped.");
if (!/^\d+\.\d+\.\d+$/.test(API_VERSION)) throw new Error("Public API version is invalid.");
if (AURA_SCHEMA_VERSION !== 1 || AURA_INSTANCE_SCHEMA_VERSION !== 2) {
  throw new Error("Release candidate schema versions do not match the documented Aura v1 / Instance v2 contract.");
}
if (String(moduleJson.compatibility?.minimum ?? "") !== "14" || String(moduleJson.compatibility?.verified ?? "") !== "14") {
  throw new Error("Foundry v14 compatibility metadata is incomplete.");
}
const pf2e = moduleJson.relationships?.systems?.find((entry) => entry.id === "pf2e");
if (!pf2e || pf2e.type !== "system" || !pf2e.compatibility?.minimum) {
  throw new Error("PF2e system compatibility metadata is missing.");
}
const criticalForge = moduleJson.relationships?.requires?.find((entry) => entry.id === "pf2e-critical-forge");
if (!criticalForge || criticalForge.type !== "module" || !criticalForge.compatibility?.minimum) {
  throw new Error("PF2E Critical Forge dependency metadata is missing.");
}
if (criticalForge.compatibility.minimum !== "1.0.1-rc.3") {
  throw new Error("Aura Forge instant outcome support requires PF2E Critical Forge 1.0.1-rc.3 or newer.");
}
if (moduleJson.socket !== true) throw new Error("Aura Forge module socket must be enabled.");

const requiredFiles = [
  "LICENSE",
  "README.md",
  "CHANGELOG.md",
  "docs/ARCHITECTURE.md",
  "scripts/main.js",
  "scripts/api/public-api.js",
  "scripts/runtime/aura-runtime-engine.js",
  "scripts/runtime/save-resolution-service.js",
  "scripts/runtime/immunity-service.js",
  "scripts/runtime/runtime-hooks.js",
  "scripts/runtime/presence-binding-service.js",
  "scripts/runtime/runtime-socket-service.js",
  "scripts/runtime/actor-data-guard.js",
  "scripts/ui/aura-editor.js",
  "templates/aura-forge-app.hbs",
  "templates/aura-editor.hbs",
  "styles/aura-forge.css",
  "lang/de.json",
  "lang/en.json"
];
for (const file of requiredFiles) await stat(resolve(root, file));

const flattenKeys = (value, prefix = "", output = []) => {
  for (const [key, child] of Object.entries(value ?? {})) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (child && typeof child === "object" && !Array.isArray(child)) flattenKeys(child, path, output);
    else output.push(path);
  }
  return output.sort();
};
const deKeys = flattenKeys(await readJson("lang/de.json"));
const enKeys = flattenKeys(await readJson("lang/en.json"));
if (JSON.stringify(deKeys) !== JSON.stringify(enKeys)) throw new Error("German and English localization keys differ.");

const rootEntries = await readdir(root, { withFileTypes: true });
if (!rootEntries.some((entry) => entry.isFile() && entry.name === "module.json")) {
  throw new Error("module.json must exist at the package root.");
}
if ((moduleJson.esmodules ?? []).some((file) => extname(file) !== ".js")) {
  throw new Error("Foundry esmodules contains a non-JavaScript entry.");
}

console.log(`release-check ok: ${moduleJson.id} ${moduleJson.version} (api ${API_VERSION}, schema ${AURA_SCHEMA_VERSION})`);
