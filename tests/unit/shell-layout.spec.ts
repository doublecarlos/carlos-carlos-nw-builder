// The app shell's pane rules: which of nav, editor and stats show, and how, at each viewport.
import { describe, expect, it } from "vitest";
import { shellLayout, viewportKind } from "../../src/lib/shell-layout";

describe("viewportKind", () => {
  it("reads desktop before phone, and tablet as neither", () => {
    expect(viewportKind(true, false)).toBe("desktop");
    expect(viewportKind(false, true)).toBe("phone");
    expect(viewportKind(false, false)).toBe("tablet");
  });
});

describe("shellLayout with a build open", () => {
  it("keeps the three rails on desktop, whatever pane a phone last showed", () => {
    for (const pane of ["editor", "stats"] as const) {
      expect(shellLayout("desktop", "build", pane)).toEqual({
        nav: "rail",
        editor: true,
        stats: "rail",
        paneSwitch: false,
      });
    }
  });

  it("puts the nav in a drawer and fixes the stats width on a tablet", () => {
    expect(shellLayout("tablet", "build", "stats")).toEqual({
      nav: "drawer",
      editor: true,
      stats: "fixed",
      paneSwitch: false,
    });
  });

  it("shows one pane at a time on a phone, with the switch", () => {
    expect(shellLayout("phone", "build", "editor")).toEqual({
      nav: "drawer",
      editor: true,
      stats: "hidden",
      paneSwitch: true,
    });
    expect(shellLayout("phone", "build", "stats")).toEqual({
      nav: "drawer",
      editor: false,
      stats: "pane",
      paneSwitch: true,
    });
  });
});

describe("shellLayout without a build", () => {
  it.each(["layer", "none"] as const)(
    "gives a %s the whole main area with no stats or switch",
    (content) => {
      expect(shellLayout("desktop", content, "stats")).toEqual({
        nav: "rail",
        editor: true,
        stats: "hidden",
        paneSwitch: false,
      });
      for (const kind of ["tablet", "phone"] as const) {
        expect(shellLayout(kind, content, "stats")).toEqual({
          nav: "drawer",
          editor: true,
          stats: "hidden",
          paneSwitch: false,
        });
      }
    },
  );
});
