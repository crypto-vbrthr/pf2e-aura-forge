import {
  AURA_SCHEMA_VERSION,
  AURA_TRIGGER_EVENTS,
  DEGREE_KEYS,
  IMMUNITY_SCOPES,
  SAVE_MODES,
  SAVE_TYPES
} from "../constants.js";

const DURATION_UNITS = new Set(["rounds", "minutes", "hours", "days"]);

function issue(severity, code, path, message, data = {}) {
  return { severity, code, path, message, data };
}

function validateEffect(effect, path, effectApi, issues) {
  if (!effect || typeof effect !== "object" || Array.isArray(effect)) {
    issues.push(issue("error", "EFFECT_REQUIRED", path, "Effect definition is required."));
    return;
  }
  if (!effectApi?.validate) return;
  const result = effectApi.validate(effect);
  for (const error of result?.errors ?? []) {
    issues.push(issue("error", "EFFECT_INVALID", path, String(error)));
  }
  for (const warning of result?.warnings ?? []) {
    issues.push(issue("warning", "EFFECT_WARNING", path, String(warning)));
  }
}

export function validateAuraDefinition(definition, { effectApi = null } = {}) {
  const issues = [];
  if (!definition || typeof definition !== "object" || Array.isArray(definition)) {
    issues.push(issue("error", "AURA_OBJECT_REQUIRED", "", "Aura definition must be an object."));
    return finalize(issues);
  }

  if (definition.schemaVersion !== AURA_SCHEMA_VERSION) {
    issues.push(issue("error", "AURA_SCHEMA_VERSION", "schemaVersion", `Expected schema version ${AURA_SCHEMA_VERSION}.`));
  }
  if (!String(definition.id ?? "").trim()) {
    issues.push(issue("error", "AURA_ID_REQUIRED", "id", "Aura id is required."));
  }
  if (!String(definition.name ?? "").trim()) {
    issues.push(issue("error", "AURA_NAME_REQUIRED", "name", "Aura name is required."));
  }
  const radius = Number(definition.radius);
  if (!Number.isFinite(radius) || radius <= 0) {
    issues.push(issue("error", "AURA_RADIUS_INVALID", "radius", "Aura radius must be greater than 0."));
  }

  const targeting = definition.targeting;
  if (!targeting || typeof targeting !== "object" || Array.isArray(targeting)) {
    issues.push(issue("error", "TARGETING_REQUIRED", "targeting", "Targeting definition is required."));
  } else if (![targeting.allies, targeting.enemies, targeting.neutral, targeting.source].some(Boolean)) {
    issues.push(issue("warning", "TARGETING_MATCHES_NOTHING", "targeting", "Aura currently targets no disposition or source."));
  }

  const presenceEffects = Array.isArray(definition.presenceEffects) ? definition.presenceEffects : [];
  const presenceIds = new Set();
  for (let index = 0; index < presenceEffects.length; index += 1) {
    const entry = presenceEffects[index];
    const path = `presenceEffects.${index}`;
    const id = String(entry?.id ?? "").trim();
    if (!id) issues.push(issue("error", "PRESENCE_ID_REQUIRED", `${path}.id`, "Presence effect id is required."));
    else if (presenceIds.has(id)) issues.push(issue("error", "PRESENCE_ID_DUPLICATE", `${path}.id`, "Presence effect id must be unique."));
    presenceIds.add(id);
    validateEffect(entry?.effect, `${path}.effect`, effectApi, issues);
  }

  const triggers = Array.isArray(definition.triggers) ? definition.triggers : [];
  const triggerIds = new Set();
  for (let index = 0; index < triggers.length; index += 1) {
    const trigger = triggers[index];
    const path = `triggers.${index}`;
    const id = String(trigger?.id ?? "").trim();
    if (!id) issues.push(issue("error", "TRIGGER_ID_REQUIRED", `${path}.id`, "Trigger id is required."));
    else if (triggerIds.has(id)) issues.push(issue("error", "TRIGGER_ID_DUPLICATE", `${path}.id`, "Trigger id must be unique."));
    triggerIds.add(id);

    if (!AURA_TRIGGER_EVENTS.includes(trigger?.event)) {
      issues.push(issue("error", "TRIGGER_EVENT_INVALID", `${path}.event`, "Trigger event is invalid."));
    }

    const save = trigger?.save;
    if (save?.enabled) {
      if (!SAVE_TYPES.includes(save.type)) issues.push(issue("error", "SAVE_TYPE_INVALID", `${path}.save.type`, "Saving throw type is invalid."));
      if (!SAVE_MODES.includes(save.mode)) issues.push(issue("error", "SAVE_MODE_INVALID", `${path}.save.mode`, "Saving throw mode is invalid."));
      if (save.dc?.mode !== "fixed") issues.push(issue("error", "SAVE_DC_MODE_INVALID", `${path}.save.dc.mode`, "Only fixed DCs are supported in this foundation milestone."));
      if (!Number.isFinite(Number(save.dc?.value)) || Number(save.dc.value) <= 0) {
        issues.push(issue("error", "SAVE_DC_INVALID", `${path}.save.dc.value`, "Saving throw DC must be greater than 0."));
      }
    }

    const outcomes = trigger?.outcomes ?? {};
    let outcomeCount = 0;
    for (const degree of DEGREE_KEYS) {
      const effect = outcomes[degree];
      if (effect != null) {
        outcomeCount += 1;
        validateEffect(effect, `${path}.outcomes.${degree}`, effectApi, issues);
      }
    }
    if (outcomeCount === 0) {
      issues.push(issue("warning", "TRIGGER_WITHOUT_OUTCOME", `${path}.outcomes`, "Trigger has no outcome effect."));
    }

    const immunity = trigger?.immunity;
    if (immunity?.enabled) {
      if (!IMMUNITY_SCOPES.includes(immunity.scope)) {
        issues.push(issue("error", "IMMUNITY_SCOPE_INVALID", `${path}.immunity.scope`, "Immunity scope is invalid."));
      }
      const value = Number(immunity.duration?.value);
      if (!Number.isFinite(value) || value <= 0) {
        issues.push(issue("error", "IMMUNITY_DURATION_INVALID", `${path}.immunity.duration.value`, "Immunity duration must be greater than 0."));
      }
      if (!DURATION_UNITS.has(immunity.duration?.unit)) {
        issues.push(issue("error", "IMMUNITY_UNIT_INVALID", `${path}.immunity.duration.unit`, "Immunity duration unit is invalid."));
      }
      const applyOn = Array.isArray(immunity.applyOn) ? immunity.applyOn : [];
      if (applyOn.some((degree) => !DEGREE_KEYS.includes(degree))) {
        issues.push(issue("error", "IMMUNITY_APPLY_ON_INVALID", `${path}.immunity.applyOn`, "Immunity contains an invalid degree of success."));
      }
    }
  }

  return finalize(issues);
}

function finalize(issues) {
  const errors = issues.filter((entry) => entry.severity === "error");
  const warnings = issues.filter((entry) => entry.severity === "warning");
  return {
    valid: errors.length === 0,
    issues,
    errors,
    warnings
  };
}
