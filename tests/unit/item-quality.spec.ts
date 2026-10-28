// Coverage for lib/item-quality.ts and the `--quality-*` colors in base.css. The contrast check
// reads the stylesheet itself, so a color tuned by eye still has to clear WCAG AA in both themes.
import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";
import {
  QUALITIES,
  isQuality,
  qualityColor,
  toneStyle,
} from "../../src/lib/item-quality";
import { ITEM_QUALITIES } from "../../src/types";

describe("item-quality", () => {
  it("lists every quality in rank order", () => {
    expect(QUALITIES.map((q) => q.id)).toEqual([...ITEM_QUALITIES]);
  });

  it("names a quality's color variable, and nothing for no quality", () => {
    expect(qualityColor("epic")).toBe("var(--quality-epic)");
    expect(qualityColor("")).toBeUndefined();
    expect(toneStyle(null)).toEqual({ "--tone": "currentColor" });
    expect(toneStyle("rare")).toEqual({ "--tone": "var(--quality-rare)" });
  });

  it("recognizes only known qualities", () => {
    expect(isQuality("mythic")).toBe(true);
    expect(isQuality("shiny")).toBe(false);
  });
});

const css = readFileSync(
  new URL("../../src/base.css", import.meta.url),
  "utf8",
);

/** Custom properties declared directly in the first block opened by `selector`. */
function tokens(selector: string): Map<string, string> {
  const start = css.indexOf(`${selector} {`);
  const body = css.slice(start, css.indexOf("\n}", start));
  const found = new Map<string, string>();
  for (const [, name, value] of body.matchAll(/(--[\w-]+):\s*([^;]+);/g))
    found.set(name, value.trim());
  return found;
}

function resolve(vars: Map<string, string>, value: string): string {
  const ref = /^var\((--[\w-]+)\)$/.exec(value);
  return ref ? resolve(vars, vars.get(ref[1]) ?? "") : value;
}

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** Every surface an item name is drawn on. */
const SURFACES = ["--bg", "--surface", "--surface-2", "--accent-soft"];

/** Light Legendary and Mythic trade contrast for their hue: at 4.5:1 on white, orange reads
 * brown and cyan reads teal. */
const RELAXED = new Set(["legendary", "mythic"]);
const minContrast = (selector: string, id: string) =>
  selector === ":root" && RELAXED.has(id) ? 4 : 4.5;

describe.each([":root", ".dark"])("quality colors in %s", (selector) => {
  const vars = tokens(selector);

  it.each([...ITEM_QUALITIES])(
    "%s clears its minimum on every surface",
    (id) => {
      const color = resolve(vars, vars.get(`--quality-${id}`) ?? "");
      expect(color).toMatch(/^#[0-9a-f]{6}$/i);
      for (const surface of SURFACES) {
        const ratio = contrast(color, resolve(vars, vars.get(surface) ?? ""));
        expect(ratio, `${id} on ${surface}`).toBeGreaterThanOrEqual(
          minContrast(selector, id),
        );
      }
    },
  );
});
