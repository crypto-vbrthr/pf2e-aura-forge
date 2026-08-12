import { matchesAuraTarget } from "./target-filter.js";

export function buildPresenceBindingKey({ auraId, presenceEffectId, sourceTokenId, targetTokenId }) {
  return [auraId, presenceEffectId, sourceTokenId, targetTokenId].map((value) => String(value ?? "")).join("::");
}

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

  return { desired, add, remove };
}
