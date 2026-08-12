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
for (const file of ["scripts/main.js", "templates/aura-forge-app.hbs", "styles/aura-forge.css", "lang/de.json", "lang/en.json"]) {
  await stat(resolve(root, file));
}
console.log(`release-check ok: ${moduleJson.id} ${moduleJson.version}`);
