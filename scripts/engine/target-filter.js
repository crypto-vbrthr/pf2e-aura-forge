function normalizeTraits(value) {
  if (value instanceof Set) return value;
  if (Array.isArray(value)) return new Set(value.map(String));
  return new Set();
}

export function matchesAuraTarget(aura, targetContext) {
  const targeting = aura?.targeting ?? {};
  const isSource = Boolean(targetContext?.isSource);
  if (isSource) return targeting.source === true;

  const disposition = String(targetContext?.disposition ?? "neutral");
  if (disposition === "ally" && targeting.allies !== true) return false;
  if (disposition === "enemy" && targeting.enemies !== true) return false;
  if (disposition === "neutral" && targeting.neutral !== true) return false;
  if (!new Set(["ally", "enemy", "neutral"]).has(disposition)) return false;

  const traits = normalizeTraits(targetContext?.traits);
  const required = Array.isArray(targeting.requiredTraits) ? targeting.requiredTraits : [];
  const excluded = Array.isArray(targeting.excludedTraits) ? targeting.excludedTraits : [];
  if (required.some((trait) => !traits.has(String(trait)))) return false;
  if (excluded.some((trait) => traits.has(String(trait)))) return false;
  return true;
}
