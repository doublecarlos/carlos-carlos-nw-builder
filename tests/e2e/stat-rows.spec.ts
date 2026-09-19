// End-to-end coverage for StatRows.vue, the shared "label / value" stat list behind
// the item hover card, the bonus inspector and the stat source card. Rows collapse their
// borders into one shared line, and hover replaces that line with an accent.
import { test, expect, type Page } from "@playwright/test";
import {
  openBuilder,
  chooseItem,
  confirmImport,
  hoverForCard,
  importText,
  slotRow,
} from "./support/app";
import { statInfoButton, statCard } from "./support/stats";

const HEAD_ITEM = "M29 Enchanted Depthweave Cap";

/** The first two rows of a shared list, plus the second row's border color before hover. */
async function firstTwoRows(page: Page, testid: string) {
  const rows = page.getByTestId(testid);
  expect(await rows.count()).toBeGreaterThanOrEqual(2);
  const [first, second] = await Promise.all([
    rows.nth(0).boundingBox(),
    rows.nth(1).boundingBox(),
  ]);
  const before = await rows.nth(1).evaluate((el) => {
    const style = getComputedStyle(el);
    return style.borderTopColor;
  });
  return { rows, first, second, before };
}

test("the item hover card's stat rows share a single collapsed border", async ({
  page,
}) => {
  await openBuilder(page);
  await chooseItem(page, "gear.head", HEAD_ITEM);
  await hoverForCard(page, slotRow(page, "gear.head"));
  const card = page.getByTestId("item-card");
  await expect(card).toBeVisible();
  const { rows, first, second, before } = await firstTwoRows(page, "stat-row");

  await expect(rows.first()).toContainText("Item Level");
  await expect(rows.first()).toContainText("+3,200");

  // Every row carries a top and bottom border and is pulled up one pixel, so two rows share a
  // single line at their boundary.
  expect(second!.y).toBeCloseTo(first!.y + first!.height - 1, 5);

  // Hovering the second row accents that shared line on both sides.
  await rows.nth(1).hover();
  const hovered = await rows.nth(1).evaluate((el) => {
    const style = getComputedStyle(el);
    return {
      top: style.borderTopColor,
      bottom: style.borderBottomColor,
    };
  });
  expect(hovered.top).toBe(hovered.bottom);
  expect(hovered.top).not.toBe(before);
});

test("the bonus inspector renders a granted stat as a shared row", async ({
  page,
}) => {
  await openBuilder(page);
  await chooseItem(page, "gear.head", HEAD_ITEM);
  await page.getByRole("button", { name: /^Bonuses/ }).click();
  // The active group sorts last, and the equipped item's one bonus grants Combat Advantage.
  await page
    .getByTestId("details-sidebar")
    .locator("button.group")
    .last()
    .click();

  const rows = page.getByTestId("bonus-stat-row");
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText("Combat Advantage");
  await expect(rows.first()).toContainText("+10.00%");
});

test("a long label wraps under itself and leaves the value on the first line's right edge", async ({
  page,
}) => {
  const RING_ID = "test-long-name-ring";
  const RING_NAME = "Celestial Enlightened Insignia of Brutality Test Ring";
  await openBuilder(page);
  await importText(
    page,
    JSON.stringify({
      name: "Long label test",
      choices: { "gear.ring1": RING_ID },
      catalog: {
        items: {
          [RING_ID]: {
            id: RING_ID,
            name: RING_NAME,
            filter: "gear_ring",
            power: 1125,
          },
        },
        bonuses: {},
        sectionPresets: {},
      },
    }),
  );
  await confirmImport(page);
  await expect(page.getByTestId("app-header")).toContainText(/imported/i);

  // The source card is the narrowest list the rows render in, so it is where a name wraps.
  await statInfoButton(page, "power").click();
  const row = statCard(page)
    .getByTestId("stat-card-row")
    .filter({ hasText: RING_NAME });
  await expect(row).toContainText("+1,125");

  const label = row.locator("span").nth(0);
  const [rowBox, labelBox, valueBox, lineHeight] = await Promise.all([
    row.boundingBox(),
    label.boundingBox(),
    row.locator("span").nth(1).boundingBox(),
    label.evaluate((el) => parseFloat(getComputedStyle(el).lineHeight)),
  ]);
  // The name really did wrap, and the value still sits on the row's first line, flush right.
  expect(labelBox!.height).toBeGreaterThan(lineHeight * 1.5);
  expect(valueBox!.y - rowBox!.y).toBeLessThan(lineHeight / 2);
  expect(
    rowBox!.x + rowBox!.width - (valueBox!.x + valueBox!.width),
  ).toBeLessThan(2);
});
