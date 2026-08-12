const DEFAULT_SELECTOR = "[data-preserve-scroll]";
const DEFAULT_BOTTOM_THRESHOLD = 32;

function finiteNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function clamp(value, minimum, maximum) {
  return Math.min(Math.max(value, minimum), maximum);
}

/** Capture explicitly marked scroll containers below a root element. */
export function captureScrollState(root, {
  selector = DEFAULT_SELECTOR,
  bottomThreshold = DEFAULT_BOTTOM_THRESHOLD
} = {}) {
  const result = new Map();
  if (!root?.querySelectorAll) return result;

  for (const element of root.querySelectorAll(selector)) {
    const key = element.dataset?.scrollKey;
    if (!key) continue;

    const scrollTop = Math.max(0, finiteNumber(element.scrollTop));
    const scrollLeft = Math.max(0, finiteNumber(element.scrollLeft));
    const maxScrollTop = Math.max(
      0,
      finiteNumber(element.scrollHeight) - finiteNumber(element.clientHeight)
    );
    const bottomOffset = Math.max(0, maxScrollTop - scrollTop);
    const threshold = Math.max(
      0,
      finiteNumber(element.dataset?.scrollBottomThreshold, bottomThreshold)
    );

    result.set(key, {
      scrollTop,
      scrollLeft,
      bottomOffset,
      stickToBottom:
        element.dataset?.scrollAnchor === "bottom" && bottomOffset <= threshold
    });
  }

  return result;
}

/** Restore a state previously returned by {@link captureScrollState}. */
export function restoreScrollState(root, state, {
  selector = DEFAULT_SELECTOR
} = {}) {
  if (!root?.querySelectorAll || !(state instanceof Map) || state.size === 0) return;

  for (const element of root.querySelectorAll(selector)) {
    const key = element.dataset?.scrollKey;
    const saved = key ? state.get(key) : null;
    if (!saved) continue;

    const maxScrollTop = Math.max(
      0,
      finiteNumber(element.scrollHeight) - finiteNumber(element.clientHeight)
    );
    const maxScrollLeft = Math.max(
      0,
      finiteNumber(element.scrollWidth) - finiteNumber(element.clientWidth)
    );

    const requestedTop = saved.stickToBottom
      ? maxScrollTop - Math.max(0, finiteNumber(saved.bottomOffset))
      : finiteNumber(saved.scrollTop);

    element.scrollTop = clamp(requestedTop, 0, maxScrollTop);
    element.scrollLeft = clamp(finiteNumber(saved.scrollLeft), 0, maxScrollLeft);
  }
}
