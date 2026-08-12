import { MODULE_ID, SETTINGS } from "../constants.js";
import { AuraRepository } from "./aura-repository.js";

export function createFoundryAuraRepository() {
  return new AuraRepository({
    get: () => game.settings.get(MODULE_ID, SETTINGS.AURA_LIBRARY),
    set: (value) => game.settings.set(MODULE_ID, SETTINGS.AURA_LIBRARY, value)
  });
}
