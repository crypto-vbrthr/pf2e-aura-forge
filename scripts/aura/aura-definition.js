import {
  AURA_SCHEMA_VERSION,
  AURA_TRIGGER_EVENTS,
  DEGREE_KEYS
} from "../constants.js";

function clone(value) {
  return value == null ? value : structuredClone(value);
}

function fallbackId(prefix = "id") {
  const uuid = globalThis.crypto?.randomUUID?.();
  if (uuid) return `${prefix}.${uuid}`;
  return `${prefix}.${Date.now().toString(36)}.${Math.random().toString(36).slice(2)}`;
}

export function createId(prefix) {
  const foundryId = globalThis.foundry?.utils?.randomID?.();
  return foundryId ? `${prefix}.${foundryId}` : fallbackId(prefix);
}

export function createTargetingDefinition(overrides = {}) {
  return {
    allies: true,
    enemies: true,
    neutral: false,
    source: false,
    requiredTraits: [],
    excludedTraits: [],
    ...clone(overrides)
  };
}

export function createSaveDefinition(overrides = {}) {
  const dc = overrides?.dc ?? {};
  return {
    enabled: false,
    type: "fortitude",
    mode: "request",
    dc: {
      mode: "fixed",
      value: 15,
      ...clone(dc)
    },
    ...clone(overrides),
    dc: {
      mode: "fixed",
      value: 15,
      ...clone(dc)
    }
  };
}

export function createImmunityDefinition(overrides = {}) {
  const duration = overrides?.duration ?? {};
  return {
    enabled: false,
    duration: {
      value: 1,
      unit: "minutes",
      ...clone(duration)
    },
    scope: "ability",
    applyOn: ["criticalSuccess", "success"],
    ...clone(overrides),
    duration: {
      value: 1,
      unit: "minutes",
      ...clone(duration)
    },
    applyOn: Array.isArray(overrides?.applyOn)
      ? [...overrides.applyOn]
      : ["criticalSuccess", "success"]
  };
}

export function createPresenceEffect(overrides = {}) {
  return {
    id: overrides.id ?? createId("presence"),
    name: overrides.name ?? "",
    effect: overrides.effect ? clone(overrides.effect) : null,
    ...clone(overrides)
  };
}

export function createAuraTrigger(overrides = {}) {
  const outcomes = Object.fromEntries(DEGREE_KEYS.map((degree) => [degree, null]));
  for (const degree of DEGREE_KEYS) {
    if (overrides?.outcomes && Object.hasOwn(overrides.outcomes, degree)) {
      outcomes[degree] = clone(overrides.outcomes[degree]);
    }
  }

  const event = AURA_TRIGGER_EVENTS.includes(overrides.event) ? overrides.event : "enter";
  return {
    id: overrides.id ?? createId("trigger"),
    name: overrides.name ?? "",
    event,
    save: createSaveDefinition(overrides.save),
    outcomes,
    immunity: createImmunityDefinition(overrides.immunity),
    ...clone(overrides),
    event,
    save: createSaveDefinition(overrides.save),
    outcomes,
    immunity: createImmunityDefinition(overrides.immunity)
  };
}

export function createAuraDefinition(overrides = {}) {
  const targeting = createTargetingDefinition(overrides.targeting);
  const presenceEffects = Array.isArray(overrides.presenceEffects)
    ? overrides.presenceEffects.map((entry) => createPresenceEffect(entry))
    : [];
  const triggers = Array.isArray(overrides.triggers)
    ? overrides.triggers.map((entry) => createAuraTrigger(entry))
    : [];

  return {
    ...clone(overrides),
    schemaVersion: AURA_SCHEMA_VERSION,
    id: overrides.id ?? createId("aura"),
    name: overrides.name ?? "",
    description: overrides.description ?? "",
    img: overrides.img ?? "icons/svg/aura.svg",
    enabled: overrides.enabled !== false,
    radius: Number.isFinite(Number(overrides.radius)) ? Number(overrides.radius) : 15,
    abilityId: overrides.abilityId ?? "",
    targeting,
    presenceEffects,
    triggers,
    metadata: {
      createdBy: "pf2e-aura-forge",
      ...clone(overrides.metadata ?? {})
    }
  };
}

export function cloneAuraDefinition(definition, {
  newIdentity = false,
  nameSuffix = ""
} = {}) {
  const copy = createAuraDefinition(clone(definition));
  if (!newIdentity) return copy;

  copy.id = createId("aura");
  copy.name = `${copy.name}${nameSuffix}`;
  copy.presenceEffects = copy.presenceEffects.map((entry) => {
    const id = createId("presence");
    const next = { ...entry, id };
    if (next.effect) next.effect = { ...clone(next.effect), id: `pf2e-aura-forge.${copy.id}.${id}` };
    return next;
  });
  copy.triggers = copy.triggers.map((entry) => {
    const id = createId("trigger");
    const outcomes = {};
    for (const degree of DEGREE_KEYS) {
      const effect = entry.outcomes?.[degree];
      outcomes[degree] = effect
        ? { ...clone(effect), id: `pf2e-aura-forge.${copy.id}.${id}.${degree}` }
        : null;
    }
    return { ...entry, id, outcomes };
  });
  return copy;
}
