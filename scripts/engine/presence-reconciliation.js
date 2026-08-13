import { matchesAuraTarget } from "./target-filter.js";

/** Legacy pre-runtime key retained only for backwards compatibility. */
export function buildPresenceBindingKey({ auraId, presenceEffectId, sourceTokenId, targetTokenId }) {
  return [auraId, presenceEffectId, sourceTokenId, targetTokenId].map((value) => String(value ?? "")).join("::");
}

/** Canonical runtime Presence identity used by both the runtime and public planner. */
export function buildRuntimePresenceBindingKey({ sceneId, sourceTokenId, instanceId, presenceEffectId, targetActorUuid }) {
  return [sceneId, sourceTokenId, instanceId, presenceEffectId, targetActorUuid]
    .map((value) => String(value ?? ""))
    .join("::");
}

function bindingEntries(activeBindings) {
  if (activeBindings instanceof Map) return new Map(activeBindings);
  if (activeBindings instanceof Set) return new Map([...activeBindings].map((key) => [key, null]));
  if (Array.isArray(activeBindings)) {
    return new Map(activeBindings
      .map((entry) => typeof entry === "string" ? [entry, null] : [entry?.key, entry])
      .filter(([key]) => Boolean(key)));
  }
  return new Map();
}

function activeFingerprint(entry) {
  return entry?.effectFingerprint ?? entry?.flag?.effectFingerprint ?? null;
}

function effectFingerprint(effect) {
  return JSON.stringify(effect ?? null);
}

/**
 * Current pure runtime Presence planner.
 *
 * Presence is actor-bound rather than token-bound: if two tokens for the same
 * Actor are inside one emitter, the Actor receives one managed Presence item
 * whose binding records both target token IDs.
 */
export function planRuntimePresenceReconciliation({
  sceneId,
  aura,
  instanceId,
  sourceActorUuid = null,
  sourceTokenId,
  candidates = [],
  activeBindings = new Set(),
  isInside,
  isPresenceBlocked = () => false
}) {
  if (!String(sceneId ?? "").trim()) throw new TypeError("sceneId is required.");
  if (!String(instanceId ?? "").trim()) throw new TypeError("instanceId is required.");
  if (!String(sourceTokenId ?? "").trim()) throw new TypeError("sourceTokenId is required.");
  if (typeof isInside !== "function") throw new TypeError("isInside callback is required.");
  if (typeof isPresenceBlocked !== "function") throw new TypeError("isPresenceBlocked callback must be a function.");

  const desired = new Map();
  const matchedByActor = new Map();
  for (const candidate of candidates) {
    const actorUuid = candidate?.actorUuid ?? candidate?.actorId ?? null;
    if (!candidate?.tokenId || !actorUuid) continue;
    if (!isInside(candidate)) continue;
    if (!matchesAuraTarget(aura, candidate)) continue;
    const entry = matchedByActor.get(String(actorUuid)) ?? { actorUuid: String(actorUuid), tokenIds: [], candidates: [] };
    entry.tokenIds.push(candidate.tokenId);
    entry.candidates.push(candidate);
    matchedByActor.set(String(actorUuid), entry);
  }

  for (const presence of aura?.presenceEffects ?? []) {
    if (!presence?.effect) continue;
    for (const target of matchedByActor.values()) {
      // Blocking is actor/emitter scoped in the live runtime. If any candidate
      // for that Actor reports a block, Presence is suppressed for the Actor.
      if (target.candidates.some((candidate) => isPresenceBlocked(candidate, presence))) continue;
      const key = buildRuntimePresenceBindingKey({
        sceneId,
        sourceTokenId,
        instanceId,
        presenceEffectId: presence.id,
        targetActorUuid: target.actorUuid
      });
      desired.set(key, {
        key,
        sceneId,
        auraId: aura?.id ?? null,
        instanceId,
        presenceEffectId: presence.id,
        sourceActorUuid,
        sourceTokenId,
        targetActorUuid: target.actorUuid,
        targetTokenIds: [...target.tokenIds],
        effect: presence.effect,
        effectFingerprint: effectFingerprint(presence.effect)
      });
    }
  }

  const active = bindingEntries(activeBindings);
  const prefix = [sceneId, sourceTokenId, instanceId].map((value) => String(value ?? "")).join("::") + "::";
  const add = [...desired.values()].filter((entry) => {
    if (!active.has(entry.key)) return true;
    const fingerprint = activeFingerprint(active.get(entry.key));
    return fingerprint != null && fingerprint !== entry.effectFingerprint;
  });
  const remove = [...active.entries()]
    .filter(([key, current]) => {
      if (!String(key).startsWith(prefix)) return false;
      const wanted = desired.get(key);
      if (!wanted) return true;
      const fingerprint = activeFingerprint(current);
      return fingerprint != null && fingerprint !== wanted.effectFingerprint;
    })
    .map(([key]) => ({ key }));

  return { contract: "runtime-v1", desired, add, remove };
}

/**
 * Deprecated token-bound planner from the 0.1.x foundation. It remains
 * exported for consumers that explicitly need the old low-level contract.
 */
export function planPresenceReconciliation({
  aura,
  sourceTokenId,
  candidates = [],
  activeBindings = new Set(),
  isInside
}) {
  if (typeof isInside !== "function") throw new TypeError("isInside callback is required.");
  const desired = new Map();

  for (const candidate of candidates) {
    if (!candidate?.tokenId) continue;
    if (!isInside(candidate)) continue;
    if (!matchesAuraTarget(aura, candidate)) continue;

    for (const presence of aura?.presenceEffects ?? []) {
      if (!presence?.effect) continue;
      const key = buildPresenceBindingKey({
        auraId: aura.id,
        presenceEffectId: presence.id,
        sourceTokenId,
        targetTokenId: candidate.tokenId
      });
      desired.set(key, {
        key,
        auraId: aura.id,
        presenceEffectId: presence.id,
        sourceTokenId,
        targetTokenId: candidate.tokenId,
        effect: presence.effect
      });
    }
  }

  const add = [...desired.values()].filter((entry) => !activeBindings.has(entry.key));
  const remove = [...activeBindings]
    .filter((key) => key.startsWith(`${aura.id}::`) && !desired.has(key))
    .map((key) => ({ key }));

  return { contract: "legacy-token-v1", desired, add, remove };
}
