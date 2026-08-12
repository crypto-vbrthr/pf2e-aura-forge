export function emitterRuntimeKey(sceneId, sourceTokenId, instanceId) {
  return [sceneId, sourceTokenId, instanceId].map((value) => String(value ?? "")).join("::");
}

export function planOccupancyTransitions(previous = new Set(), current = new Set()) {
  const entered = [...current].filter((id) => !previous.has(id));
  const left = [...previous].filter((id) => !current.has(id));
  return { entered, left };
}
