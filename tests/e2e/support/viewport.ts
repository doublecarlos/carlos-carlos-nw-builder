// Layout checks shared by the mobile specs.
import { expect, type Page } from "@playwright/test";

/** The narrowest viewport the app supports. */
export const MIN_SUPPORTED_WIDTH = 360;

/** Asserts the page itself cannot scroll sideways: nothing on it is wider than the viewport.
 *  Regions that scroll on their own (overflow-x-auto tables) do not count. */
export async function expectNoHorizontalScroll(page: Page) {
  const { scrollWidth, clientWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(scrollWidth).toBeLessThanOrEqual(clientWidth);
}
