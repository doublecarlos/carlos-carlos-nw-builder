// An editor form's bar with a long entry name: the title wraps onto its own row instead of
// squeezing the actions, at phone widths and in the desktop's narrow form beside the list.
import { test, expect, type Page } from "@playwright/test";
import { openNewLayer } from "../support/nav";
import {
  MIN_SUPPORTED_WIDTH,
  expectNoHorizontalScroll,
} from "../support/viewport";

const LONG_NAME =
  "Exceptionally Long Item Name Of The Radiant Dawn Guardian, Masterwork Edition";

const bar = (page: Page) => page.getByTestId("form-bar").first();

/** Opens a shipped item and renames it, so the bar has a long title and the edited badge. */
async function openRenamedItem(page: Page) {
  await openNewLayer(page);
  await page.locator(".editor-row").nth(3).tap();
  await page.getByTestId("item-name-input").fill(LONG_NAME);
  await expect(page.getByTestId("form-bar-title").first()).toHaveText(
    LONG_NAME,
  );
}

/** Asserts the title overlaps none of the bar's controls and the checkbox's label is one line. */
async function expectBarReadable(page: Page) {
  const { overlaps, checkboxLines } = await bar(page).evaluate((el) => {
    const title = el
      .querySelector('[data-testid="form-bar-title"]')!
      .getBoundingClientRect();
    const overlaps = [...el.querySelectorAll("button, label")]
      .map((control) => control.getBoundingClientRect())
      .filter(
        (r) =>
          r.left < title.right &&
          r.right > title.left &&
          r.top < title.bottom &&
          r.bottom > title.top,
      ).length;
    const text = el.querySelector('[data-testid="show-all-fields"] span')!;
    const range = document.createRange();
    range.selectNodeContents(text);
    const checkboxLines = new Set(
      [...range.getClientRects()]
        .filter((r) => r.width > 0)
        .map((r) => Math.round(r.top)),
    ).size;
    return { overlaps, checkboxLines };
  });
  expect(overlaps).toBe(0);
  expect(checkboxLines).toBe(1);
}

for (const width of [MIN_SUPPORTED_WIDTH, 412]) {
  test(`a long item name keeps the bar readable at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 800 });
    await openRenamedItem(page);

    await expectBarReadable(page);
    // The narrow bar's second row holds the icon actions, below the title.
    const heading = await page
      .getByTestId("form-bar-heading")
      .first()
      .boundingBox();
    const actions = await page
      .getByTestId("form-bar-actions")
      .first()
      .boundingBox();
    expect(actions!.y).toBeGreaterThanOrEqual(heading!.y + heading!.height);
    await expectNoHorizontalScroll(page);
  });
}

test("a long item name keeps the bar readable beside the desktop list", async ({
  page,
}) => {
  await openRenamedItem(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(page.getByTestId("layer-entries-column")).toBeVisible();

  await expectBarReadable(page);
  await expectNoHorizontalScroll(page);
});
