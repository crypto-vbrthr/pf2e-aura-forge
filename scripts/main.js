import { MODULE_ID, MODULE_VERSION } from "./constants.js";
import { getAuraRuntimeEngine, initializePublicApi } from "./api/public-api.js";
import { registerSettings } from "./settings.js";
import { assertEffectForgeApi, getEffectForgeApi } from "./integration/effect-forge-bridge.js";
import { registerAuraRuntimeHooks } from "./runtime/runtime-hooks.js";
import { AuraRuntimeSocketService } from "./runtime/runtime-socket-service.js";
import { initializeAuraForgeUi, openAuraForge } from "./ui/aura-forge.js";

Hooks.once("init", () => {
  registerSettings();
  initializePublicApi({ openAuraForge });
});

Hooks.once("ready", async () => {
  try {
    const manifestVersion = String(game.modules.get(MODULE_ID)?.version ?? "");
    if (manifestVersion && manifestVersion !== MODULE_VERSION) {
      const message = `${MODULE_ID} | Mixed installation detected: manifest ${manifestVersion}, scripts ${MODULE_VERSION}. Reinstall the module cleanly and restart Foundry.`;
      console.error(message);
      ui.notifications.error(message, { permanent: true });
      return;
    }
    const effectApi = assertEffectForgeApi(getEffectForgeApi());
    const runtime = getAuraRuntimeEngine()?.setEffectApi(effectApi) ?? null;
    initializeAuraForgeUi();
    const api = game.modules.get(MODULE_ID)?.api;
    const reconciliation = await api?.instances?.reconcileAll?.();
    const reconciliationErrors = (reconciliation ?? []).filter((entry) => entry.error);
    if (reconciliationErrors.length > 0) {
      console.warn(`${MODULE_ID} | Some actor aura abilities could not be reconciled.`, reconciliationErrors);
    }

    if (runtime) {
      const socketService = new AuraRuntimeSocketService({ runtime, gameRef: game });
      socketService.register();
      runtime.setSocketService(socketService);
      registerAuraRuntimeHooks(runtime);
      if (globalThis.canvas?.ready && globalThis.canvas?.scene) {
        await runtime.reconcileScene(globalThis.canvas.scene, { seed: true, fireEvents: false });
      }
    }

    Hooks.callAll("pf2eAuraForgeReady", api);
    console.info(`${MODULE_ID} | Ready`, {
      moduleVersion: api?.moduleVersion,
      apiVersion: api?.version,
      auraSchemaVersion: api?.schemaVersion,
      effectApiVersion: effectApi.version,
      effectSchemaVersion: effectApi.schemaVersion,
      runtime: Boolean(runtime)
    });
  } catch (error) {
    console.error(`${MODULE_ID} | PF2E Critical Forge integration is unavailable.`, error);
    ui.notifications.error(game.i18n.localize("PF2E_AURA_FORGE.Notifications.EffectForgeMissing"));
  }
});
