// The build editor's "show unavailable" lens: the pickers re-offer what they normally withhold,
// each row saying why. The bug it fixes is a one-way door -- clearing a retired pick used to
// lose it for good, since only the slot still holding one keeps it listed.
//
// Items are built through the real layer editor rather than by editing shipped game data, the
// same way item-retirement.spec.ts does: nothing shipped is retired.
import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";
import { openBuilder, slotRow, pickerInput, chooseItem } from "./support/app";
import { addLayer, layerRow } from "./support/nav";

const RETIRED_ITEM = "ZZZ Test Withheld Ring";
const CAPPED_ITEM = "ZZZ Test Capped Ring";

async function createItem(
  page: Page,
  name: string,
  { maxCopies }: { maxCopies?: number } = {},
) {
  await page.getByTestId("new-item").click();
  await page.getByTestId("item-name-input").fill(name);
  await page.getByTestId("item-filter-input").fill("gear_ring");
  if (maxCopies !== undefined) {
    await page.getByTestId("item-max-copies").fill(String(maxCopies));
  }
  await page.getByRole("button", { name: "Save item" }).click();
}

async function openLayer(page: Page) {
  await layerRow(page, "Layer 1").locator(".nav-name").click();
}

async function openBuild(page: Page) {
  await page
    .getByTestId("library")
    .locator(".nav-row--build")
    .first()
    .locator(".nav-name")
    .click();
  await expect(page.getByTestId("builder-content")).toBeVisible();
}

/** Ticks "hide from pickers" on an existing item. Edits are live, so there is no Save. */
async function retireItem(page: Page, name: string) {
  await page.locator(".editor-row-name", { hasText: name }).first().click();
  await page.getByTestId("item-hide-from-picker").click();
}

test("a cleared retired pick can be picked back once the lens is on", async ({
  page,
}) => {
  await openBuilder(page);
  await addLayer(page);
  await openLayer(page);
  await createItem(page, RETIRED_ITEM);

  await openBuild(page);
  await chooseItem(page, "gear.ring1", RETIRED_ITEM);

  await openLayer(page);
  await retireItem(page, RETIRED_ITEM);

  await openBuild(page);
  const row = slotRow(page, "gear.ring1");
  await row.scrollIntoViewIfNeeded();

  // Clearing the pick is what used to lose the item: the slot holding one is the only place
  // still offering it.
  await pickerInput(row).click();
  await row.getByTestId("picker-menu").getByText("- empty -").click();
  await expect(pickerInput(row)).toHaveValue("");

  await pickerInput(row).click();
  await expect(
    row.getByTestId("picker-menu").getByText(RETIRED_ITEM, { exact: true }),
  ).toHaveCount(0);
  await page.keyboard.press("Escape");

  await page.getByTestId("show-hidden-toggle").click();

  const input = pickerInput(row);
  await input.click();
  await input.fill(RETIRED_ITEM);
  const option = row.getByTestId("picker-menu").getByText(RETIRED_ITEM, {
    exact: true,
  });
  await expect(option).toBeVisible();
  // The row says what is wrong with it, so a wider list is not just a longer one.
  await expect(
    row.getByTestId("picker-option-hidden-reason").first(),
  ).toHaveText("retired");

  await option.click();
  await expect(pickerInput(row)).toHaveValue(RETIRED_ITEM);

  // Turning the lens back off withholds it again, without disturbing the pick just made.
  await page.getByTestId("show-hidden-toggle").click();
  await expect(pickerInput(row)).toHaveValue(RETIRED_ITEM);
  const other = slotRow(page, "gear.ring2");
  await other.scrollIntoViewIfNeeded();
  await pickerInput(other).click();
  await expect(
    other.getByTestId("picker-menu").getByText(RETIRED_ITEM, { exact: true }),
  ).toHaveCount(0);
});

test("a candidate at its copy cap comes back saying how many are spent", async ({
  page,
}) => {
  await openBuilder(page);
  await addLayer(page);
  await openLayer(page);
  await createItem(page, CAPPED_ITEM, { maxCopies: 1 });

  await openBuild(page);
  await chooseItem(page, "gear.ring1", CAPPED_ITEM);

  const other = slotRow(page, "gear.ring2");
  await other.scrollIntoViewIfNeeded();
  const input = pickerInput(other);
  await input.click();
  await input.fill(CAPPED_ITEM);
  await expect(
    other.getByTestId("picker-menu").getByText(CAPPED_ITEM, { exact: true }),
  ).toHaveCount(0);
  await page.keyboard.press("Escape");

  await page.getByTestId("show-hidden-toggle").click();
  await other.scrollIntoViewIfNeeded();
  await input.click();
  await input.fill(CAPPED_ITEM);
  await expect(
    other.getByTestId("picker-menu").getByText(CAPPED_ITEM, { exact: true }),
  ).toBeVisible();
  await expect(other.getByTestId("picker-option-hidden-reason")).toHaveText(
    "1/1 copies",
  );
});
