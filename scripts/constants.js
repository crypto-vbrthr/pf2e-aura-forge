export const MODULE_ID = "pf2e-aura-forge";
export const MODULE_VERSION = "0.1.1";
export const API_VERSION = "0.1.0";
export const AURA_SCHEMA_VERSION = 1;
export const AURA_STORAGE_VERSION = 1;
export const EFFECT_FORGE_MODULE_ID = "pf2e-critical-forge";
export const REQUIRED_EFFECT_API_VERSION = "0.9.4";

export const SETTINGS = Object.freeze({
  AURA_LIBRARY: "auraLibrary",
  WINDOW_STATE: "windowState"
});

export const AURA_TRIGGER_EVENTS = Object.freeze([
  "enter",
  "leave",
  "turnStart",
  "turnEnd"
]);

export const SAVE_TYPES = Object.freeze(["fortitude", "reflex", "will"]);
export const SAVE_MODES = Object.freeze(["request", "automatic", "gm"]);
export const IMMUNITY_SCOPES = Object.freeze(["instance", "source", "ability"]);
export const DEGREE_KEYS = Object.freeze([
  "criticalSuccess",
  "success",
  "failure",
  "criticalFailure"
]);
