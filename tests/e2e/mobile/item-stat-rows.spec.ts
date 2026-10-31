// The item form's stat rows on a phone: each row is a card of two lines, the picker on the
// first and the value beside the Add/Remove pair on the second, and nothing scrolls sideways.
import { test, expect, type Locator, type Page } from "@playwright/test";
import { openBuilder, pickerScreen } from "../support/app";
import { addLayer, confirmDialog, layerRow } from "../support/nav";
import {
  MIN_SUPPORTED_WIDTH,
  expectNoHorizontalScroll,
} from "../support/viewport";

const form = (page: Page) => page.getByTestId("layer-form-pane");
/** Filled rows only: the empty state reuses the row class for its lone Add. */
const statRows = (page: Page) =>
  form(page).locator(".stat-row[data-testid=repeatable-row]");
const dynamicRows = (page: Page) =>
  form(page).locator(".dynamic-stat-row[data-testid=repeatable-row]");

async function openNewItem(page: Page) {
  await openBuilder(page);
  await page.getByTestId("header-nav-toggle").click();
  await addLayer(page);
  if (!(await page.getByTestId("nav-drawer").isVisible()))
    await page.getByTestId("header-nav-toggle").click();
  await layerRow(page, "Layer 1").locator(".nav-name").click();
  await page.getByTestId("new-item").tap();
  await page.getByTestId("show-all-fields").tap();
}

async function box(target: Locator) {
  const found = await target.boundingBox();
  expect(found).not.toBeNull();
  return found!;
}

/** Adds rows from the list's own Add button until it holds `count`. */
async function addRows(rows: Locator, addLabel: string, count: number) {
  const page = rows.page();
  await page.getByRole("button", { name: addLabel, exact: true }).first().tap();
  while ((await rows.count()) < count)
    await rows
      .last()
      .getByRole("button", { name: addLabel, exact: true })
      .tap();
  await expect(rows).toHaveCount(count);
}

/** The card's first line holds the picker, and the value and Add/Remove pair sit below it. */
async function expectCard(row: Locator) {
  const card = await box(row);
  const lead = await box(row.getByTestId("repeatable-row-lead"));
  const rest = await box(row.getByTestId("repeatable-row-rest"));
  const actions = await box(row.getByTestId("repeatable-row-actions"));

  expect(lead.x).toBeGreaterThan(card.x);
  expect(rest.y).toBeGreaterThanOrEqual(lead.y + lead.height);
  expect(actions.y).toBeGreaterThanOrEqual(lead.y + lead.height);
  return { card };
}

async function expectFits(page: Page) {
  await expectNoHorizontalScroll(page);
  const { scrollWidth, clientWidth } = await form(page).evaluate((el) => ({
    scrollWidth: el.scrollWidth,
    clientWidth: el.clientWidth,
  }));
  expect(scrollWidth).toBeLessThanOrEqual(clientWidth);
}

for (const width of [MIN_SUPPORTED_WIDTH, 412]) {
  test(`stat rows are two-line cards at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    await openNewItem(page);
    await addRows(statRows(page), "Add stat", 3);

    const cards = [];
    for (let i = 0; i < 3; i++)
      cards.push(await expectCard(statRows(page).nth(i)));
    for (let i = 1; i < 3; i++) {
      // Cards stand apart rather than touching.
      expect(cards[i]!.card.y).toBeGreaterThan(
        cards[i - 1]!.card.y + cards[i - 1]!.card.height,
      );
    }
    await expectFits(page);

    await addRows(dynamicRows(page), "Add dynamic stat", 2);
    for (let i = 0; i < 2; i++) await expectCard(dynamicRows(page).nth(i));
    await expectFits(page);
  });
}

test("a stat row's picker opens full-screen and fills in the row", async ({
  page,
}) => {
  await page.setViewportSize({ width: MIN_SUPPORTED_WIDTH, height: 740 });
  await openNewItem(page);
  await addRows(statRows(page), "Add stat", 1);
  const picker = statRows(page).first().locator(".combo--stat input");

  await picker.tap();
  await expect(pickerScreen(page)).toBeVisible();
  await expect(pickerScreen(page)).toContainText("Stat");
  const option = pickerScreen(page).getByTestId("picker-option").first();
  const label = (await option.textContent())!.trim();
  await option.tap();
  await expect(pickerScreen(page)).toHaveCount(0);
  await expect(picker).toHaveValue(label);
  // Closing the screen steps back over its own history entry without leaving the draft.
  await expect(confirmDialog(page)).toHaveCount(0);
  await expect(page.getByTestId("layer-form-back")).toBeVisible();
});

test("removing a stat card drops that row and keeps the others", async ({
  page,
}) => {
  await page.setViewportSize({ width: MIN_SUPPORTED_WIDTH, height: 740 });
  await openNewItem(page);
  await addRows(statRows(page), "Add stat", 3);
  for (let i = 0; i < 3; i++)
    await statRows(page)
      .nth(i)
      .getByTestId("repeatable-row-rest")
      .locator("input")
      .fill(String(i + 1));

  await statRows(page)
    .nth(1)
    .getByRole("button", { name: "Remove stat", exact: true })
    .tap();
  await expect(statRows(page)).toHaveCount(2);
  const rest = (i: number) =>
    statRows(page).nth(i).getByTestId("repeatable-row-rest").locator("input");
  await expect(rest(0)).toHaveValue("1");
  await expect(rest(1)).toHaveValue("3");

  await statRows(page)
    .nth(0)
    .getByRole("button", { name: "Remove stat", exact: true })
    .tap();
  await statRows(page)
    .nth(0)
    .getByRole("button", { name: "Remove stat", exact: true })
    .tap();
  await expect(statRows(page)).toHaveCount(0);
  await expect(
    form(page).getByRole("button", { name: "Add stat", exact: true }),
  ).toBeVisible();
});

test("a tablet keeps the stat rows on one line", async ({ page }) => {
  await page.setViewportSize({ width: 820, height: 1180 });
  await openBuilder(page);
  await page.getByTestId("header-nav-toggle").click();
  await addLayer(page);
  if (!(await page.getByTestId("nav-drawer").isVisible()))
    await page.getByTestId("header-nav-toggle").click();
  await layerRow(page, "Layer 1").locator(".nav-name").click();
  await page.getByTestId("new-item").click();
  await addRows(statRows(page), "Add stat", 1);

  const row = statRows(page).first();
  const [picker, value] = await Promise.all([
    box(row.locator(".combo--stat")),
    box(row.getByTestId("repeatable-row-rest").locator("input")),
  ]);
  expect(value.x).toBeGreaterThan(picker.x + picker.width);
  expect(Math.abs(value.y - picker.y)).toBeLessThan(picker.height);
});
