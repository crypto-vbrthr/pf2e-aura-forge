const DEGREE_KEYS_BY_INDEX = Object.freeze([
  "criticalFailure",
  "failure",
  "success",
  "criticalSuccess"
]);

function collectionContents(collection) {
  if (!collection) return [];
  if (Array.isArray(collection)) return collection;
  if (Array.isArray(collection.contents)) return collection.contents;
  try { return Array.from(collection); } catch { return []; }
}

function sameUser(a, b) {
  if (!a || !b) return false;
  if (a === b) return true;
  return String(a.id ?? a._id ?? "") !== ""
    && String(a.id ?? a._id) === String(b.id ?? b._id);
}

function activeUsers(gameRef = globalThis.game) {
  return collectionContents(gameRef?.users).filter((user) => user?.active !== false);
}

export function primaryActiveGM(gameRef = globalThis.game) {
  const activeGM = gameRef?.users?.activeGM;
  if (activeGM?.active !== false && activeGM?.isGM) return activeGM;
  return activeUsers(gameRef)
    .filter((user) => user?.isGM)
    .sort((a, b) => String(a.id ?? "").localeCompare(String(b.id ?? "")))[0] ?? null;
}

function userOwnsActor(user, actor) {
  if (!user || !actor) return false;
  if (user.character?.id && String(user.character.id) === String(actor.id)) return true;
  if (typeof actor.testUserPermission === "function") {
    try { if (actor.testUserPermission(user, "OWNER")) return true; } catch { /* fall through */ }
  }
  if (typeof actor.canUserModify === "function") {
    try { return actor.canUserModify(user, "update"); } catch { return false; }
  }
  return false;
}

/**
 * Pick exactly one client to resolve a saving throw.
 *
 * PF2e's Actor#primaryUpdater deliberately prefers an active GM. That is ideal
 * for document mutations, but not for Aura Forge's "Spieler anfordern" mode:
 * the roll dialog should live on an active owner client when one exists.
 */
export function resolveSaveUser(actor, mode, gameRef = globalThis.game) {
  const users = activeUsers(gameRef);
  const gm = primaryActiveGM(gameRef);

  if (mode === "gm") return gm;

  if (mode === "request") {
    const assigned = users.find((user) => !user.isGM && user.character?.id && String(user.character.id) === String(actor?.id));
    if (assigned) return assigned;

    const owner = users
      .filter((user) => !user.isGM && userOwnsActor(user, actor))
      .sort((a, b) => String(a.id ?? "").localeCompare(String(b.id ?? "")))[0];
    if (owner) return owner;

    return gm ?? actor?.primaryUpdater ?? null;
  }

  // Automatic saves do not need an owner-facing dialog. Prefer one active GM
  // so hidden information and multi-client rolls remain deterministic.
  if (mode === "automatic") {
    return gm ?? actor?.primaryUpdater ?? users.find((user) => userOwnsActor(user, actor)) ?? null;
  }

  return actor?.primaryUpdater ?? gm ?? null;
}

export function degreeKeyFromRoll(roll) {
  const raw = roll?.degreeOfSuccess;
  if (raw == null) return null;
  const degree = Number(raw);
  return Number.isInteger(degree) && degree >= 0 && degree < DEGREE_KEYS_BY_INDEX.length
    ? DEGREE_KEYS_BY_INDEX[degree]
    : null;
}

export function resolveSaveStatistic(actor, saveType) {
  return actor?.saves?.[saveType] ?? actor?.getStatistic?.(saveType) ?? null;
}

export function canResolveSaveForMode(actor, mode, gameRef = globalThis.game) {
  const user = gameRef?.user;
  const resolver = resolveSaveUser(actor, mode, gameRef);
  return sameUser(user, resolver);
}

export class AuraSaveResolutionService {
  constructor({ gameRef = globalThis.game } = {}) {
    this.gameRef = gameRef;
  }

  canResolve(actor, saveDefinition) {
    return canResolveSaveForMode(actor, saveDefinition?.mode ?? "request", this.gameRef);
  }

  async roll({ targetActor, targetToken, sourceActor, trigger, aura }) {
    const save = trigger?.save;
    if (!save?.enabled) return { status: "not-required", roll: null, degree: null };
    if (!this.canResolve(targetActor, save)) return { status: "not-resolver", roll: null, degree: null };

    const statistic = resolveSaveStatistic(targetActor, save.type);
    if (!statistic || typeof statistic.roll !== "function") {
      return { status: "unavailable", roll: null, degree: null, saveType: save.type };
    }

    const mode = save.mode ?? "request";
    const dc = Number(save.dc?.value);
    const titleParts = [String(aura?.name ?? "").trim(), String(trigger?.name ?? "").trim()].filter(Boolean);
    const title = titleParts.join(" · ") || statistic.label;
    const roll = await statistic.roll({
      dc: Number.isFinite(dc) ? dc : 0,
      origin: sourceActor ?? null,
      token: targetToken ?? null,
      title,
      identifier: `pf2e-aura-forge-${trigger.id ?? "save"}`,
      extraRollOptions: [
        "aura",
        "aura-forge",
        `aura-forge:event:${trigger.event ?? "unknown"}`,
        `aura-forge:aura:${aura?.id ?? "unknown"}`
      ],
      skipDialog: mode === "automatic"
    });

    if (!roll) return { status: "cancelled", roll: null, degree: null };
    const degree = degreeKeyFromRoll(roll);
    return {
      status: degree ? "resolved" : "unresolved-degree",
      roll,
      degree,
      saveType: save.type,
      dc: Number.isFinite(dc) ? dc : 0
    };
  }
}
