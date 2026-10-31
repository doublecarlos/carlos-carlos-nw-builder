// An editor form's bar with a long entry name: the title wraps instead of squeezing the
// actions. A phone's bar is one compact row of Back, title and a menu; wider bars keep their
// icon actions and checkbox in view.
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

/** Asserts the title overlaps none of the bar's controls, and a visible checkbox's label is
 *  one line. */
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
    const text = el.querySelector('[data-testid="show-all-fields"] span');
    if (!text) return { overlaps, checkboxLines: 1 };
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
  test(`a long item name keeps the phone's one-row bar readable at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 800 });
    await openRenamedItem(page);

    await expectBarReadable(page);
    // Back and the menu share the title's row, so the form keeps the height.
    const heading = (await page
      .getByTestId("form-bar-heading")
      .first()
      .boundingBox())!;
    for (const testid of ["layer-form-back", "form-bar-menu"]) {
      const box = (await page.getByTestId(testid).boundingBox())!;
      expect(box.y).toBeLessThan(heading.y + heading.height);
      expect(box.y + box.height).toBeGreaterThan(heading.y);
    }
    await expectNoHorizontalScroll(page);

    // The menu names each action, and holds the checkbox the row has no room for.
    await page.getByTestId("form-bar-menu").tap();
    const menu = page.getByRole("group", { name: "item actions" });
    await expect(menu.getByRole("button", { name: "Duplicate" })).toBeVisible();
    await expect(
      menu.getByRole("button", { name: "From screenshot" }),
    ).toBeVisible();
    await expect(menu.getByTestId("show-all-fields")).toBeVisible();
  });
}

for (const width of [1024, 1440]) {
  test(`a long item name keeps the bar readable beside the list at ${width}px`, async ({
    page,
  }) => {
    await openRenamedItem(page);
    await page.setViewportSize({ width, height: 900 });
    await expect(page.getByTestId("layer-entries-column")).toBeVisible();
    await expect(page.getByTestId("show-all-fields")).toBeVisible();

    await expectBarReadable(page);
    await expectNoHorizontalScroll(page);
  });
}
