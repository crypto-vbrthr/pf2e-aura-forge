import { MODULE_ID } from "./constants.js";
import { initializePublicApi } from "./api/public-api.js";
import { registerSettings } from "./settings.js";
import { assertEffectForgeApi, getEffectForgeApi } from "./integration/effect-forge-bridge.js";
import { initializeAuraForgeUi, openAuraForge } from "./ui/aura-forge.js";

Hooks.once("init", () => {
  registerSettings();
  initializePublicApi({ openAuraForge });
});

Hooks.once("ready", async () => {
  try {
    const effectApi = assertEffectForgeApi(getEffectForgeApi());
    initializeAuraForgeUi();
    const api = game.modules.get(MODULE_ID)?.api;
    const reconciliation = await api?.instances?.reconcileAll?.();
    const reconciliationErrors = (reconciliation ?? []).filter((entry) => entry.error);
    if (reconciliationErrors.length > 0) {
      console.warn(`${MODULE_ID} | Some actor aura abilities could not be reconciled.`, reconciliationErrors);
    }
    Hooks.callAll("pf2eAuraForgeReady", api);
    console.info(`${MODULE_ID} | Ready`, {
      moduleVersion: api?.moduleVersion,
      apiVersion: api?.version,
      auraSchemaVersion: api?.schemaVersion,
      effectApiVersion: effectApi.version,
      effectSchemaVersion: effectApi.schemaVersion
    });
  } catch (error) {
    console.error(`${MODULE_ID} | PF2E Critical Forge integration is unavailable.`, error);
    ui.notifications.error(game.i18n.localize("PF2E_AURA_FORGE.Notifications.EffectForgeMissing"));
  }
});
