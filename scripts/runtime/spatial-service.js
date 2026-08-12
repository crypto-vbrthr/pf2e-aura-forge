/**
 * Runtime spatial helpers. PF2e Token placeables expose distanceTo(), which
 * measures token-to-token distance rather than center-to-center distance. The
 * rectangle fallback keeps tests and degraded canvas states deterministic.
 */

function rectangleFor(token, scene) {
  const bounds = token?.mechanicalBounds ?? token?.bounds;
  if (bounds && [bounds.x, bounds.y, bounds.width, bounds.height].every(Number.isFinite)) {
    return bounds;
  }
  const gridSize = Number(scene?.grid?.size) || 100;
  const x = Number(token?.x ?? token?._source?.x) || 0;
  const y = Number(token?.y ?? token?._source?.y) || 0;
  const width = (Number(token?.width) || 1) * gridSize;
  const height = (Number(token?.height) || 1) * gridSize;
  return { x, y, width, height };
}

function rectangleGap(a, b) {
  const ax2 = a.x + a.width;
  const ay2 = a.y + a.height;
  const bx2 = b.x + b.width;
  const by2 = b.y + b.height;
  const dx = Math.max(0, a.x - bx2, b.x - ax2);
  const dy = Math.max(0, a.y - by2, b.y - ay2);
  return Math.hypot(dx, dy);
}

export function tokenDistance(sourceToken, targetToken, { scene = sourceToken?.scene ?? targetToken?.scene } = {}) {
  if (!sourceToken || !targetToken) return Infinity;
  if (sourceToken === targetToken || sourceToken.id === targetToken.id) return 0;

  const sourceObject = sourceToken.object;
  const targetObject = targetToken.object;
  // PF2e Token#distanceTo measures placeable positions. During a Foundry token
  // movement animation those positions intentionally lag behind the already
  // updated TokenDocument coordinates. Using distanceTo in that window inverts
  // enter/leave presence logic: a token entering still looks outside, while a
  // token leaving still looks inside. Prefer document coordinates while either
  // placeable is animating, then return to PF2e's native distance calculation.
  const placeableAnimating = Boolean(sourceObject?.animation || targetObject?.animation);
  if (!placeableAnimating && sourceObject && targetObject && typeof sourceObject.distanceTo === "function") {
    const measured = Number(sourceObject.distanceTo(targetObject));
    if (Number.isFinite(measured)) return measured;
  }

  const pixels = rectangleGap(rectangleFor(sourceToken, scene), rectangleFor(targetToken, scene));
  const gridPixels = Number(scene?.grid?.size) || 100;
  const gridDistance = Number(scene?.grid?.distance) || 5;
  return (pixels / gridPixels) * gridDistance;
}

export function auraContainsToken(sourceToken, targetToken, radius, { scene = sourceToken?.scene ?? targetToken?.scene } = {}) {
  if (!sourceToken || !targetToken) return false;
  if (sourceToken.hidden || targetToken.hidden) return false;
  const numericRadius = Number(radius);
  if (!Number.isFinite(numericRadius) || numericRadius < 0) return false;
  return tokenDistance(sourceToken, targetToken, { scene }) <= numericRadius + 1e-6;
}
