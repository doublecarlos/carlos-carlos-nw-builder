// The item form's stat rows on a phone: each row is a card of two lines, the picker on the
// first and the value beside the Add/Remove pair on the second. Fit at phone widths is checked
// in layout-sweep.spec.ts.
import { test, expect, type Locator, type Page } from "@playwright/test";
import { pickerScreen } from "../support/app";
import { confirmDialog, openNewLayer } from "../support/nav";
import { MIN_SUPPORTED_WIDTH } from "../support/viewport";

const form = (page: Page) => page.getByTestId("layer-form-pane");
/** Filled rows only: the empty state reuses the row class for its lone Add. */
const statRows = (page: Page) =>
  form(page).locator(".stat-row[data-testid=repeatable-row]");
const dynamicRows = (page: Page) =>
  form(page).locator(".dynamic-stat-row[data-testid=repeatable-row]");

async function openNewItem(page: Page) {
  await openNewLayer(page);
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

/** Where a row's parts sit: a two-line card has the picker inset on its first line, and the
 *  value and Add/Remove pair below it. */
async function cardLayout(row: Locator) {
  const card = await box(row);
  const lead = await box(row.getByTestId("repeatable-row-lead"));
  const rest = await box(row.getByTestId("repeatable-row-rest"));
  const actions = await box(row.getByTestId("repeatable-row-actions"));
  const leadBottom = lead.y + lead.height;
  return {
    leadInset: lead.x > card.x,
    restBelowLead: rest.y >= leadBottom,
    actionsBelowLead: actions.y >= leadBottom,
  };
}

const TWO_LINE_CARD = {
  leadInset: true,
  restBelowLead: true,
  actionsBelowLead: true,
};

for (const width of [MIN_SUPPORTED_WIDTH, 412]) {
  test(`stat rows are two-line cards at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    await openNewItem(page);
    await addRows(statRows(page), "Add stat", 3);
    for (let i = 0; i < 3; i++)
      expect(await cardLayout(statRows(page).nth(i))).toEqual(TWO_LINE_CARD);

    await addRows(dynamicRows(page), "Add dynamic stat", 2);
    for (let i = 0; i < 2; i++)
      expect(await cardLayout(dynamicRows(page).nth(i))).toEqual(TWO_LINE_CARD);
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
  await openNewLayer(page);
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
