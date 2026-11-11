// SegmentedControl wraps with plain CSS when one row does not fit: a label never breaks inside
// its segment, and every wrapped line still spans the control, so it stays a rectangle. Runs
// in Firefox too, since the wrap follows each engine's own text widths.
import { test, expect, type Page } from "@playwright/test";
import { openBuilder } from "./support/app";
import { addLayer, layerRow } from "./support/nav";

/** The payload switch of a new grant, squeezed so its four long labels cannot share a row. */
async function squeezedPayloadSwitch(page: Page) {
  await openBuilder(page);
  await addLayer(page);
  await layerRow(page, "Layer 1").locator(".nav-name").click();
  await page.getByRole("button", { name: /Bonuses \d+/ }).click();
  await page.getByTestId("new-bonus").click();
  await page.getByLabel("Add grant").click();
  const payload = page.getByTestId("grant-payload").first();
  await payload.evaluate((el) => (el.style.width = "16rem"));
  return payload.getByTestId("segmented-group");
}

test(
  "a squeezed control wraps whole labels into full lines",
  { tag: "@cross-browser" },
  async ({ page }) => {
    const group = await squeezedPayloadSwitch(page);
    await expect(group.getByRole("button")).toHaveCount(4);
    const layout = await group.evaluate((el) => {
      const outer = el.getBoundingClientRect();
      const segments = [...el.children].map((child) => {
        const range = document.createRange();
        range.selectNodeContents(child);
        // One line can yield overlapping rects; a later line starts below the first's middle.
        const [first, ...rest] = [...range.getClientRects()];
        const lines =
          1 + rest.filter((r) => r.top > first!.top + first!.height / 2).length;
        return { box: child.getBoundingClientRect(), lines };
      });
      return {
        outer: { left: outer.left, right: outer.right },
        segments: segments.map(({ box, lines }) => ({
          top: Math.round(box.top),
          left: box.left,
          right: box.right,
          lines,
        })),
      };
    });

    for (const { lines } of layout.segments) expect(lines).toBe(1);

    const rows = new Map<number, { left: number; right: number }[]>();
    for (const s of layout.segments)
      rows.set(s.top, [...(rows.get(s.top) ?? []), s]);
    expect(rows.size).toBeGreaterThan(1);
    // Each line runs from the control's left edge to its right one, within its outline.
    for (const line of rows.values()) {
      const left = Math.min(...line.map((s) => s.left));
      const right = Math.max(...line.map((s) => s.right));
      expect(left).toBeGreaterThan(layout.outer.left);
      expect(left - layout.outer.left).toBeLessThanOrEqual(2);
      expect(right).toBeLessThan(layout.outer.right);
      expect(layout.outer.right - right).toBeLessThanOrEqual(2);
    }
  },
);
