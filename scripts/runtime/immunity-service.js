import { MODULE_ID } from "../constants.js";
import { repairMalformedPhysicalDescriptions } from "./actor-data-guard.js";

export const IMMUNITY_FLAG = "auraImmunity";

function clone(value) {
  if (value == null) return value;
  const deepClone = globalThis.foundry?.utils?.deepClone;
  return typeof deepClone === "function" ? deepClone(value) : structuredClone(value);
}

function itemList(actor) {
  const items = actor?.items;
  if (!items) return [];
  if (Array.isArray(items)) return items;
  if (Array.isArray(items.contents)) return items.contents;
  try { return Array.from(items); } catch { return []; }
}

function worldTime(gameRef = globalThis.game) {
  const value = Number(gameRef?.time?.worldTime);
  return Number.isFinite(value) ? value : 0;
}

function durationSeconds(duration) {
  const value = Number(duration?.value);
  if (!Number.isFinite(value) || value <= 0) return null;
  const multipliers = { minutes: 60, hours: 3600, days: 86400 };
  const multiplier = multipliers[duration?.unit];
  return multiplier ? value * multiplier : null;
}

function abilityKey(aura) {
  return String(aura?.abilityId ?? "").trim() || String(aura?.id ?? "");
}

export function immunityScopeKey({ emitter, immunity }) {
  const aura = emitter?.aura ?? {};
  const sourceActorUuid = emitter?.sourceActor?.uuid ?? emitter?.sourceActor?.id ?? "";
  const sourceTokenId = emitter?.sourceToken?.id ?? "";
  const instanceId = emitter?.instance?.id ?? "";
  const key = abilityKey(aura);

  switch (immunity?.scope) {
    case "instance":
      return `instance::${emitter?.scene?.id ?? ""}::${sourceTokenId}::${instanceId}::${key}`;
    case "source":
      return `source::${sourceActorUuid}::${key}`;
    case "ability":
    default:
      return `ability::${key}`;
  }
}

export function immunityFlag(item) {
  return item?.getFlag?.(MODULE_ID, IMMUNITY_FLAG)
    ?? item?.flags?.[MODULE_ID]?.[IMMUNITY_FLAG]
    ?? null;
}

export function isImmunityExpired(item, binding, { gameRef = globalThis.game } = {}) {
  if (item?.isExpired === true || item?.system?.expired === true) return true;
  const expiresAtWorldTime = Number(binding?.expiresAtWorldTime);
  if (Number.isFinite(expiresAtWorldTime) && expiresAtWorldTime > 0) {
    return worldTime(gameRef) >= expiresAtWorldTime;
  }
  return false;
}

export function createImmunityBinding({ emitter, trigger, targetActor, gameRef = globalThis.game }) {
  const immunity = trigger?.immunity ?? {};
  const startedAtWorldTime = worldTime(gameRef);
  const seconds = durationSeconds(immunity.duration);
  return {
    managed: true,
    scope: immunity.scope ?? "ability",
    blocksPresence: immunity.blocksPresence !== false,
    scopeKey: immunityScopeKey({ emitter, immunity }),
    auraId: emitter?.aura?.id ?? null,
    abilityId: abilityKey(emitter?.aura),
    instanceId: emitter?.instance?.id ?? null,
    sourceActorUuid: emitter?.sourceActor?.uuid ?? emitter?.sourceActor?.id ?? null,
    sourceTokenId: emitter?.sourceToken?.id ?? null,
    triggerId: trigger?.id ?? null,
    targetActorUuid: targetActor?.uuid ?? targetActor?.id ?? null,
    duration: clone(immunity.duration),
    startedAtWorldTime,
    expiresAtWorldTime: seconds == null ? null : startedAtWorldTime + seconds
  };
}

function immunityName(emitter, gameRef = globalThis.game) {
  const auraName = String(emitter?.aura?.name ?? "Aura");
  const localized = gameRef?.i18n?.localize?.("PF2E_AURA_FORGE.ImmunityEffectName");
  const prefix = localized && localized !== "PF2E_AURA_FORGE.ImmunityEffectName" ? localized : "Aura immunity";
  return `${prefix}: ${auraName}`;
}

export function createImmunityEffectSource({ emitter, trigger, targetActor, gameRef = globalThis.game }) {
  const immunity = trigger?.immunity ?? {};
  const binding = createImmunityBinding({ emitter, trigger, targetActor, gameRef });
  const duration = clone(immunity.duration ?? { value: 1, unit: "minutes" });
  return {
    name: immunityName(emitter, gameRef),
    type: "effect",
    img: emitter?.aura?.img ?? "icons/svg/aura.svg",
    system: {
      description: { value: String(emitter?.aura?.description ?? ""), gm: "" },
      rules: [],
      slug: null,
      traits: { value: [], otherTags: [] },
      level: { value: 1 },
      duration: {
        value: Number(duration.value) || 1,
        unit: duration.unit ?? "minutes",
        expiry: "turn-start",
        sustained: false
      },
      // Match normal PF2e effect source semantics: PF2e stamps the actual
      // start time/initiative when the embedded effect is created.
      start: { value: 0, initiative: null },
      badge: null,
      tokenIcon: { show: true },
      unidentified: false
    },
    flags: {
      [MODULE_ID]: {
        [IMMUNITY_FLAG]: binding
      }
    }
  };
}

export class AuraImmunityService {
  constructor({ gameRef = globalThis.game } = {}) {
    this.gameRef = gameRef;
  }

  active(actor, emitter, trigger) {
    const immunity = trigger?.immunity;
    if (!actor || !immunity?.enabled) return [];
    const scopeKey = immunityScopeKey({ emitter, immunity });
    return itemList(actor).filter((item) => {
      const binding = immunityFlag(item);
      return binding?.managed === true
        && binding.scopeKey === scopeKey
        && !isImmunityExpired(item, binding, { gameRef: this.gameRef });
    });
  }

  has(actor, emitter, trigger) {
    return this.active(actor, emitter, trigger).length > 0;
  }

  activeForEmitter(actor, emitter) {
    if (!actor || !emitter) return [];
    return itemList(actor).filter((item) => {
      const binding = immunityFlag(item);
      if (binding?.managed !== true || !binding.scopeKey) return false;
      if (isImmunityExpired(item, binding, { gameRef: this.gameRef })) return false;
      const expected = immunityScopeKey({ emitter, immunity: { scope: binding.scope ?? "ability" } });
      return binding.scopeKey === expected;
    });
  }

  hasForEmitter(actor, emitter) {
    return this.activeForEmitter(actor, emitter).length > 0;
  }

  activePresenceBlocking(actor, emitter) {
    return this.activeForEmitter(actor, emitter).filter((item) => {
      const binding = immunityFlag(item);
      // Legacy 0.4.0 immunity Items did not carry this field. Treat them as
      // whole-aura immunity so existing worlds get the intuitive behavior.
      return binding?.blocksPresence !== false;
    });
  }

  blocksPresence(actor, emitter) {
    return this.activePresenceBlocking(actor, emitter).length > 0;
  }

  async apply(actor, emitter, trigger) {
    if (!actor || !trigger?.immunity?.enabled) return [];
    const existing = this.active(actor, emitter, trigger);
    if (existing.length > 0) return existing;
    await repairMalformedPhysicalDescriptions(actor);
    if (typeof actor.createEmbeddedDocuments !== "function") throw new Error("Actor does not support embedded Item creation.");
    return actor.createEmbeddedDocuments("Item", [createImmunityEffectSource({
      emitter,
      trigger,
      targetActor: actor,
      gameRef: this.gameRef
    })], { renderSheet: false });
  }

  async cleanupExpired(actor) {
    if (!actor) return 0;
    const ids = itemList(actor)
      .filter((item) => {
        const binding = immunityFlag(item);
        return binding?.managed === true && isImmunityExpired(item, binding, { gameRef: this.gameRef });
      })
      .map((item) => item?.id)
      .filter(Boolean);
    if (ids.length === 0) return 0;
    await repairMalformedPhysicalDescriptions(actor);
    if (typeof actor.deleteEmbeddedDocuments === "function") {
      await actor.deleteEmbeddedDocuments("Item", ids);
      return ids.length;
    }
    return 0;
  }
}
