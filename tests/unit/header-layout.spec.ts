// The header's placement rules: which actions sit in the bar and which in the overflow menu.
import { describe, expect, it } from "vitest";
import { headerLayout } from "../../src/lib/header-layout";

describe("headerLayout", () => {
  it("keeps every action in the desktop bar, with no menu", () => {
    const { bar, menu } = headerLayout("desktop", false);
    expect([...bar]).toEqual([
      "export",
      "import",
      "importFromGame",
      "stable",
      "shortcuts",
      "about",
      "theme",
    ]);
    expect(menu).toEqual([]);
  });

  it("keeps the file actions in a tablet bar and moves the rest to the menu", () => {
    const { bar, menu } = headerLayout("tablet", false);
    expect([...bar]).toEqual(["export", "import", "shortcuts"]);
    expect(menu).toEqual(["importFromGame", "stable", "about", "theme"]);
  });

  it("puts every action in the phone menu, in order", () => {
    const { bar, menu } = headerLayout("phone", false);
    expect(bar.size).toBe(0);
    expect(menu).toEqual([
      "export",
      "import",
      "importFromGame",
      "stable",
      "shortcuts",
      "about",
      "theme",
    ]);
  });

  it("drops the keyboard shortcuts on a coarse pointer at every width", () => {
    for (const kind of ["desktop", "tablet", "phone"] as const) {
      const { bar, menu } = headerLayout(kind, true);
      expect(bar.has("shortcuts")).toBe(false);
      expect(menu).not.toContain("shortcuts");
    }
  });

  it("keeps About and Theme reachable at every width", () => {
    for (const kind of ["desktop", "tablet", "phone"] as const) {
      for (const coarse of [false, true]) {
        const { bar, menu } = headerLayout(kind, coarse);
        for (const action of ["about", "theme"] as const)
          expect(bar.has(action) || menu.includes(action)).toBe(true);
      }
    }
  });
});
