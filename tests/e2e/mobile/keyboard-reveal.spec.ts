// A field focused low in the editor list stays visible when the on-screen keyboard shrinks the
// visual viewport. Playwright can't open a real keyboard, so the visual viewport is shrunk by
// hand, the way iOS Safari does it without resizing the layout.
import { test, expect, type Page } from "@playwright/test";
import { openBuilder } from "../support/app";

const KEYBOARD_TOP = 400;

/** Focuses a text field in the list that sits below where the keyboard will reach. */
async function focusLowField(page: Page) {
  await page.getByTestId("editor-column").evaluate((scroller, top) => {
    const field = [
      ...scroller.querySelectorAll<HTMLInputElement>(
        'input:not([type="checkbox"]):not([type="radio"]):not([readonly])',
      ),
    ].find((el) => {
      const rect = el.getBoundingClientRect();
      return rect.top > top + 50 && rect.bottom < window.innerHeight - 80;
    });
    if (!field) throw new Error("No field below the keyboard line");
    field.dataset.lowField = "";
    field.focus({ preventScroll: true });
  }, KEYBOARD_TOP);
}

/** Shrinks the visual viewport to end at `height`, as an opening keyboard does. */
async function openKeyboard(page: Page, height: number) {
  await page.evaluate((h) => {
    const visual = window.visualViewport!;
    Object.defineProperty(visual, "height", {
      configurable: true,
      get: () => h,
    });
    visual.dispatchEvent(new Event("resize"));
  }, height);
}

test("a focused field low in the list scrolls above the keyboard", async ({
  page,
}) => {
  await openBuilder(page);
  await focusLowField(page);
  await openKeyboard(page, KEYBOARD_TOP);

  const field = page.locator("[data-low-field]");
  await expect
    .poll(
      async () =>
        (await field.boundingBox())!.y + (await field.boundingBox())!.height,
    )
    .toBeLessThanOrEqual(KEYBOARD_TOP);
  expect((await field.boundingBox())!.y).toBeGreaterThanOrEqual(0);
});

test("the pane switch makes way while a field has focus", async ({ page }) => {
  await openBuilder(page);
  await focusLowField(page);
  // It would otherwise ride up with the keyboard and cover the field.
  await expect(page.getByTestId("pane-switch")).toBeHidden();

  await page.locator("[data-low-field]").blur();
  await expect(page.getByTestId("pane-switch")).toBeVisible();
});
