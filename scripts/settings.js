import { AURA_STORAGE_VERSION, MODULE_ID, SETTINGS } from "./constants.js";

export function registerSettings() {
  game.settings.register(MODULE_ID, SETTINGS.AURA_LIBRARY, {
    name: "PF2E_AURA_FORGE.Settings.AuraLibrary",
    scope: "world",
    config: false,
    type: Object,
    default: { storageVersion: AURA_STORAGE_VERSION, auras: [] }
  });

  game.settings.register(MODULE_ID, SETTINGS.WINDOW_STATE, {
    name: "PF2E_AURA_FORGE.Settings.WindowState",
    scope: "client",
    config: false,
    type: Object,
    default: {}
  });
}
