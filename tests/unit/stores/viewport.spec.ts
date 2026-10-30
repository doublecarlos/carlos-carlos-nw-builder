// Viewport flags: each one follows its own media query, and the phone/desktop pair splits at
// Tailwind's breakpoints so the flags and the `md:`/`lg:` utilities agree.
import { describe, expect, it, beforeAll, vi } from "vitest";
import { installWindowShim } from "./window-shim";

/** Answers the store's queries the way a viewport `width` CSS px wide (1rem = 16px) with the
 *  given pointer would. */
function installMatchMedia(width: number, pointer: "fine" | "coarse") {
  const rem = (q: string) => Number(/([\d.]+)rem/.exec(q)?.[1]) * 16;
  const matches = (q: string) => {
    if (q.includes("pointer")) return q.includes(pointer);
    if (q.includes(">=")) return width >= rem(q);
    if (q.includes("<")) return width < rem(q);
    throw new Error(`unexpected query ${q}`);
  };
  (globalThis as unknown as { matchMedia: unknown }).matchMedia = (
    query: string,
  ) => ({
    matches: matches(query),
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  });
}

beforeAll(() => {
  installWindowShim();
});

const freshStore = async () => {
  vi.resetModules();
  return import("../../../src/stores/viewport");
};

describe("viewport flags", () => {
  it("splits phone below md and desktop from lg", async () => {
    const { BREAKPOINTS, QUERIES } = await freshStore();

    expect(BREAKPOINTS).toEqual({ md: "48rem", lg: "64rem" });
    expect(QUERIES.phone).toBe("(width < 48rem)");
    expect(QUERIES.desktop).toBe("(width >= 64rem)");
  });

  it.each([
    {
      width: 360,
      pointer: "coarse",
      desktop: false,
      phone: true,
      coarse: true,
    },
    {
      width: 767,
      pointer: "coarse",
      desktop: false,
      phone: true,
      coarse: true,
    },
    {
      width: 768,
      pointer: "fine",
      desktop: false,
      phone: false,
      coarse: false,
    },
    {
      width: 1023,
      pointer: "fine",
      desktop: false,
      phone: false,
      coarse: false,
    },
    {
      width: 1024,
      pointer: "fine",
      desktop: true,
      phone: false,
      coarse: false,
    },
    {
      width: 1440,
      pointer: "coarse",
      desktop: true,
      phone: false,
      coarse: true,
    },
  ] as const)(
    "reads $width px with a $pointer pointer",
    async ({ width, pointer, desktop, phone, coarse }) => {
      installMatchMedia(width, pointer);
      const viewport = await freshStore();

      expect(viewport.isDesktop.value).toBe(desktop);
      expect(viewport.isPhone.value).toBe(phone);
      expect(viewport.coarsePointer.value).toBe(coarse);
    },
  );
});
