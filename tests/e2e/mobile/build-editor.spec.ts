// The build editor on a phone: rows and toolbar fit the narrowest width, the toolbar's actions
// live in an overflow menu, and the item card opens from a button instead of on hover.
import { test, expect, type Locator, type Page } from "@playwright/test";
import { chooseItem, openBuilder, pickerInput, slotRow } from "../support/app";
import {
  MIN_SUPPORTED_WIDTH,
  expectNoHorizontalScroll,
} from "../support/viewport";

const HEAD_ITEM = "M29 Enchanted Depthweave Cap";

const actionsMenu = (page: Page) => page.getByTestId("editor-actions");
const action = (page: Page, key: string) =>
  page.getByTestId(`editor-actions-${key}`);
const sheet = (page: Page) => page.getByTestId("item-card-sheet");

/** Asserts `locator` lies within the viewport's width. */
async function expectWithinWidth(page: Page, locator: Locator) {
  const box = await locator.boundingBox();
  if (!box) throw new Error("Not visible");
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(page.viewportSize()!.width);
}

for (const width of [MIN_SUPPORTED_WIDTH, 412]) {
  test(`the editor does not scroll sideways at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 800 });
    await openBuilder(page);
    await chooseItem(page, "gear.head", HEAD_ITEM);

    await expect(page.getByTestId("editor-pane")).toBeVisible();
    await expectNoHorizontalScroll(page);
    // Every row's content stays inside the list, so nothing scrolls sideways within it either.
    for (const body of await page.getByTestId("section-body").all()) {
      const { scrollWidth, clientWidth } = await body.evaluate((el) => ({
        scrollWidth: el.scrollWidth,
        clientWidth: el.clientWidth,
      }));
      expect(scrollWidth).toBeLessThanOrEqual(clientWidth);
    }
    await expectWithinWidth(page, page.getByTestId("quick-options"));
    await expectWithinWidth(page, actionsMenu(page));
  });
}

test("a row's label sits above its control", async ({ page }) => {
  await openBuilder(page);
  const row = slotRow(page, "gear.head");
  const label = (await row.locator(".slot-label").boundingBox())!;
  const input = (await pickerInput(row).boundingBox())!;
  expect(input.y).toBeGreaterThanOrEqual(label.y + label.height);
});

test("the toolbar's actions sit in an overflow menu", async ({ page }) => {
  await openBuilder(page);
  await expect(page.getByTestId("editor-expand-all")).toHaveCount(0);
  await expect(page.getByTestId("picker-options")).toHaveCount(0);
  await chooseItem(page, "gear.head", HEAD_ITEM);
  const headInput = pickerInput(slotRow(page, "gear.head"));
  await expect(headInput).toHaveValue(HEAD_ITEM);

  // Undo keeps the menu open, so several steps take one visit.
  await actionsMenu(page).click();
  await expect(action(page, "undo")).toBeEnabled();
  await action(page, "undo").click();
  await expect(headInput).toHaveValue("");
  await expect(action(page, "redo")).toBeEnabled();
  await action(page, "redo").click();
  await expect(headInput).toHaveValue(HEAD_ITEM);

  // Collapsing closes it: the list under it has changed.
  await action(page, "collapse-all").click();
  await expect(action(page, "collapse-all")).toBeHidden();
  await expect(page.getByTestId("section-body")).toHaveCount(0);

  await actionsMenu(page).click();
  await expect(action(page, "collapse-all")).toBeDisabled();
  await action(page, "expand-all").click();
  await expect(page.getByTestId("section-body").first()).toBeVisible();

  // The picker options toggle in place.
  await actionsMenu(page).click();
  const showCard = action(page, "picker:showCard").locator("input");
  await expect(showCard).toBeChecked();
  await showCard.click();
  await expect(showCard).not.toBeChecked();
  await expectNoHorizontalScroll(page);
});

test("a row's info button opens its item card in a sheet", async ({ page }) => {
  await openBuilder(page);
  const row = slotRow(page, "gear.head");
  await expect(page.getByTestId("slot-info:gear.head")).toHaveCount(0);
  await chooseItem(page, "gear.head", HEAD_ITEM);

  await page.getByTestId("slot-info:gear.head").click();
  await expect(sheet(page).getByTestId("item-card-name")).toHaveText(HEAD_ITEM);
  await expectWithinWidth(page, sheet(page).getByTestId("item-card"));
  await expectNoHorizontalScroll(page);

  await sheet(page).getByTestId("sheet-close").click();
  await expect(sheet(page)).toHaveCount(0);
  await expect(row).toBeVisible();

  // The backdrop closes it too.
  await page.getByTestId("slot-info:gear.head").click();
  await expect(sheet(page)).toBeVisible();
  await sheet(page).click({ position: { x: 10, y: 10 } });
  await expect(sheet(page)).toHaveCount(0);
});

test("tapping a row does not open the hover card", async ({ page }) => {
  await openBuilder(page);
  await chooseItem(page, "gear.head", HEAD_ITEM);
  await page.getByTestId("app-header").click({ position: { x: 4, y: 4 } });

  await page.clock.install();
  // A tap fires the row's `mouseenter` before its click, which is what would arm the card.
  await slotRow(page, "gear.head").locator(".slot-label").hover();
  // Past the hover card's opening delay.
  await page.clock.fastForward(1000);
  await expect(page.getByTestId("item-card")).toHaveCount(0);
});
