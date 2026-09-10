// The build editor's "show unavailable" lens: the pickers re-offer what they normally withhold,
// each row saying why. The bug it fixes is a one-way door -- clearing a retired pick used to
// lose it for good, since only the slot still holding one keeps it listed.
//
// Items are built through the real layer editor rather than by editing shipped game data, the
// same way item-retirement.spec.ts does: nothing shipped is retired.
import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";
import {
  chooseItem,
  openBuilder,
  pickerInput,
  setItemFilter,
  slotRow,
  togglePickerOption,
} from "./support/app";
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
  await setItemFilter(page, "gear_ring");
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

  await togglePickerOption(page, "showHidden");

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
  await togglePickerOption(page, "showHidden");
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

  await togglePickerOption(page, "showHidden");
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

// Typing a full id is unambiguous, so the picker offers it even while the lens is off, with
// the same "why it is withheld" label.
test("an exact id offers a withheld candidate without turning the lens on", async ({
  page,
}) => {
  await openBuilder(page);
  await addLayer(page);
  await openLayer(page);
  await createItem(page, RETIRED_ITEM);
  await retireItem(page, RETIRED_ITEM);
  const itemId = (
    await page.getByTestId("item-id-value").textContent()
  )?.trim() as string;
  expect(itemId).toBeTruthy();

  await openBuild(page);
  const row = slotRow(page, "gear.ring1");
  await row.scrollIntoViewIfNeeded();
  const input = pickerInput(row);

  // The name alone still gets nothing: the lens is off and the item is retired.
  await input.click();
  await input.fill(RETIRED_ITEM);
  await expect(
    row.getByTestId("picker-menu").getByText(RETIRED_ITEM, { exact: true }),
  ).toHaveCount(0);

  await input.fill(itemId);
  const option = row
    .getByTestId("picker-menu")
    .getByText(RETIRED_ITEM, { exact: true });
  await expect(option).toBeVisible();
  await expect(
    row.getByTestId("picker-option-hidden-reason").first(),
  ).toHaveText("retired");

  await option.click();
  await expect(pickerInput(row)).toHaveValue(RETIRED_ITEM);
});

// The id is always available to the exact-id override; this option only decides whether a
// partial id narrows the list the way a name does.
test("searching by id is opt-in for partial matches", async ({ page }) => {
  await openBuilder(page);
  await addLayer(page);
  await openLayer(page);
  await createItem(page, RETIRED_ITEM);
  const itemId = (
    await page.getByTestId("item-id-value").textContent()
  )?.trim() as string;
  const partial = itemId.slice(0, itemId.length - 2);

  await openBuild(page);
  const row = slotRow(page, "gear.ring1");
  await row.scrollIntoViewIfNeeded();
  const input = pickerInput(row);
  const option = row
    .getByTestId("picker-menu")
    .getByText(RETIRED_ITEM, { exact: true });

  await input.click();
  await input.fill(partial);
  await expect(option).toHaveCount(0);
  await page.keyboard.press("Escape");

  await togglePickerOption(page, "searchById");
  await row.scrollIntoViewIfNeeded();
  await input.click();
  await input.fill(partial);
  await expect(option).toBeVisible();
});

// Flipping one option must not cost a reopen to flip the next: that is why these are
// checkboxes and not command rows.
test("the picker options menu stays open while its rows are toggled", async ({
  page,
}) => {
  await openBuilder(page);
  await page.getByTestId("picker-options").click();

  const hidden = page.getByTestId("picker-options:showHidden");
  const byId = page.getByTestId("picker-options:searchById");
  await expect(hidden.getByRole("checkbox")).not.toBeChecked();

  await hidden.click();
  await expect(hidden.getByRole("checkbox")).toBeChecked();
  await expect(byId).toBeVisible();

  await byId.click();
  await expect(byId.getByRole("checkbox")).toBeChecked();
  await expect(hidden.getByRole("checkbox")).toBeChecked();

  await page.keyboard.press("Escape");
  await expect(hidden).toBeHidden();
});
