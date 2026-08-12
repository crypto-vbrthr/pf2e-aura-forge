import test from "node:test";
import assert from "node:assert/strict";
import { captureScrollState, restoreScrollState } from "../scripts/ui/view-state.js";

function fakeElement({
  key,
  scrollTop = 0,
  scrollLeft = 0,
  scrollHeight = 1000,
  clientHeight = 200,
  scrollWidth = 400,
  clientWidth = 200,
  anchor = null
} = {}) {
  return {
    dataset: {
      scrollKey: key,
      ...(anchor ? { scrollAnchor: anchor } : {})
    },
    scrollTop,
    scrollLeft,
    scrollHeight,
    clientHeight,
    scrollWidth,
    clientWidth
  };
}

function rootWith(elements) {
  return { querySelectorAll: () => elements };
}

test("scroll state survives a full Aura Forge rerender", () => {
  const before = fakeElement({ key: "main", scrollTop: 480, scrollLeft: 17 });
  const state = captureScrollState(rootWith([before]));

  const after = fakeElement({ key: "main", scrollTop: 0, scrollLeft: 0 });
  restoreScrollState(rootWith([after]), state);

  assert.equal(after.scrollTop, 480);
  assert.equal(after.scrollLeft, 17);
});

test("scroll restoration clamps positions when the rerendered content is shorter", () => {
  const before = fakeElement({ key: "main", scrollTop: 700, scrollHeight: 1000, clientHeight: 200 });
  const state = captureScrollState(rootWith([before]));

  const after = fakeElement({ key: "main", scrollTop: 0, scrollHeight: 500, clientHeight: 200 });
  restoreScrollState(rootWith([after]), state);

  assert.equal(after.scrollTop, 300);
});
