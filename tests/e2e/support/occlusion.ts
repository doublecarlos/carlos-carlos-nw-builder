import { expect, type Locator } from "@playwright/test";

/** Asserts `locator` paints on top at several points down its own center, via
 *  `document.elementFromPoint`; unlike `toBeVisible()`, which passes even when occluded. */
export async function expectTopmost(locator: Locator) {
  const uncovered = await locator.evaluate((el) => {
    const rect = el.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const fractions = [0.1, 0.3, 0.5, 0.7, 0.9];
    return fractions
      .map((f) => rect.top + rect.height * f)
      .filter((y) => {
        const hit = document.elementFromPoint(x, y);
        return !hit || !(hit === el || el.contains(hit));
      });
  });
  expect(uncovered).toEqual([]);
}
