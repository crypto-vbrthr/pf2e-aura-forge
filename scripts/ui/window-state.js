export const AURA_FORGE_DEFAULT_WINDOW_SIZE = Object.freeze({
  width: 1500,
  height: 960
});

export const AURA_FORGE_LEGACY_DEFAULT_WINDOW_SIZE = Object.freeze({
  width: 1240,
  height: 840
});

export function normalizeWindowState(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const result = {};
  for (const key of ["left", "top", "width", "height"]) {
    if (Number.isFinite(Number(value[key]))) result[key] = Number(value[key]);
  }
  return result;
}

export function normalizeSavedWindowState(value) {
  const result = normalizeWindowState(value);
  if (
    result.width === AURA_FORGE_LEGACY_DEFAULT_WINDOW_SIZE.width &&
    result.height === AURA_FORGE_LEGACY_DEFAULT_WINDOW_SIZE.height
  ) {
    result.width = AURA_FORGE_DEFAULT_WINDOW_SIZE.width;
    result.height = AURA_FORGE_DEFAULT_WINDOW_SIZE.height;
  }
  return result;
}
