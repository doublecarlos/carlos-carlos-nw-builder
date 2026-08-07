// Tests for stores/editorScroll.ts: a single remembered scrollTop for the build editor.
import { describe, expect, it } from "vitest";
import { buildScrollTop } from "../../../src/stores/editorScroll";

describe("editorScroll store", () => {
  it("starts at 0", () => {
    expect(buildScrollTop.value).toBe(0);
  });

  it("remembers whatever is written to it", () => {
    buildScrollTop.value = 240;
    expect(buildScrollTop.value).toBe(240);
  });
});
