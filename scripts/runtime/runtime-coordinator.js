import { primaryActiveGM } from "./save-resolution-service.js";

function collectionContents(collection) {
  if (!collection) return [];
  if (Array.isArray(collection)) return collection;
  if (Array.isArray(collection.contents)) return collection.contents;
  try { return Array.from(collection); } catch { return []; }
}

export function runtimeCoordinatorUser(gameRef = globalThis.game) {
  const gm = primaryActiveGM(gameRef);
  if (gm) return gm;
  return collectionContents(gameRef?.users)
    .filter((user) => user?.active !== false)
    .sort((a, b) => String(a.id ?? "").localeCompare(String(b.id ?? "")))[0] ?? gameRef?.user ?? null;
}

export function isRuntimeCoordinator(gameRef = globalThis.game) {
  const coordinator = runtimeCoordinatorUser(gameRef);
  const user = gameRef?.user;
  return Boolean(coordinator && user && String(coordinator.id ?? "") === String(user.id ?? ""));
}
