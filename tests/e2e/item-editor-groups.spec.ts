// End-to-end coverage for the item editor's dynamic stats (a repeatable row list, like
// Stats) and inline repetition (a single group hidden behind an "add" button, with a trash
// button that clears it back to unset rather than leaving stale values behind that a
// disabled/empty-looking field can't fully clean up).
import { test, expect, type Page } from "@playwright/test";
import { openBuilder } from "./support/app";
import { addLayer, layerRow } from "./support/nav";

const UNIQUE_ITEM = "ZZZ Test Groups Item";

/** Creates a brand-new item draft in a fresh layer and fills in the minimum required
 *  fields, leaving the item form open for further edits. */
async function openNewItemForm(page: Page) {
  await openBuilder(page);
  await addLayer(page);
  await layerRow(page, "Layer 1").locator(".nav-name").click();
  await page.getByTestId("new-item").click();
  await page.getByTestId("item-name-input").fill(UNIQUE_ITEM);
  await page.getByTestId("item-filter-input").fill("gear_head");
}

test("dynamic stat rows can be added and removed, like Stats", async ({
  page,
}) => {
  await openNewItemForm(page);

  const rows = page.locator(".dynamic-stat-row");
  await expect(rows).toHaveCount(1); // the empty "Add" row
  await expect(
    page.getByRole("button", { name: "Add dynamic stat" }).first(),
  ).toBeVisible();

  await page.getByRole("button", { name: "Add dynamic stat" }).first().click();
  await expect(rows).toHaveCount(1);

  const row = rows.last();
  const statPicker = row.getByTestId("picker-input");
  const numberInputs = row.locator('input[type="number"]');
  await statPicker.click();
  await statPicker.fill("Item Level");
  await row.getByText("Item Level", { exact: true }).click();
  await numberInputs.nth(0).fill("10"); // Min
  await numberInputs.nth(1).fill("20"); // Max
  await numberInputs.nth(2).fill("15"); // Default

  await row.getByRole("button", { name: "Remove dynamic stat" }).click();

  // Removing the only row leaves the empty "Add" row behind, with no stale values.
  await expect(rows).toHaveCount(1);
  await page.getByRole("button", { name: "Add dynamic stat" }).first().click();
  await expect(rows.last().getByTestId("picker-input")).toHaveValue("");
});

test("inline repetition group is hidden until added, then fully removable", async ({
  page,
}) => {
  await openNewItemForm(page);

  await expect(
    page.getByRole("button", { name: "Add inline repetition" }),
  ).toBeVisible();
  await expect(page.getByTestId("inline-repetition-fields")).toBeHidden();

  await page.getByRole("button", { name: "Add inline repetition" }).click();
  const fields = page.getByTestId("inline-repetition-fields");
  await expect(fields).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Remove inline repetition" }),
  ).toBeVisible();

  const numberInputs = fields.locator('input[type="number"]');
  await numberInputs.nth(0).fill("0"); // Min
  await numberInputs.nth(1).fill("100"); // Max
  await numberInputs.nth(2).fill("50"); // Default

  await page.getByRole("button", { name: "Remove inline repetition" }).click();

  await expect(fields).toBeHidden();
  await expect(
    page.getByRole("button", { name: "Add inline repetition" }),
  ).toBeVisible();

  // Re-adding must not resurrect the values that were just cleared.
  await page.getByRole("button", { name: "Add inline repetition" }).click();
  await expect(numberInputs.nth(0)).toHaveValue("");
  await expect(numberInputs.nth(1)).toHaveValue("");
  await expect(numberInputs.nth(2)).toHaveValue("");
});

test("pre-added empty stat rows on a saved item survive filling one of them", async ({
  page,
}) => {
  await openNewItemForm(page);
  await page.getByRole("button", { name: "Save item" }).click();

  // The item is saved from here on, so every edit auto-saves and round-trips back into the
  // form. The add-rows-first workflow: add five empty rows, fill only the first one, and
  // the four still-empty ones must survive that round-trip.
  const rows = page.locator(".stat-row");
  await expect(rows).toHaveCount(1); // the empty "Add" row
  for (let i = 0; i < 5; i++) {
    await page.getByRole("button", { name: "Add stat" }).first().click();
  }
  await expect(rows).toHaveCount(5);

  const picker = rows.first().getByTestId("picker-input");
  await picker.click();
  await picker.fill("Power");
  await rows.first().getByText("Power", { exact: true }).click();

  // Past the 700ms auto-save debounce.
  await page.waitForTimeout(1500);
  await expect(rows).toHaveCount(5);
  await expect(picker).toHaveValue("Power");
  await expect(rows.nth(1).getByTestId("picker-input")).toHaveValue("");
});

test("removing inline repetition on an existing item omits it from the saved item", async ({
  page,
}) => {
  await openNewItemForm(page);

  await page.getByRole("button", { name: "Add inline repetition" }).click();
  const fields = page.getByTestId("inline-repetition-fields");
  const numberInputs = fields.locator('input[type="number"]');
  await numberInputs.nth(0).fill("0");
  await numberInputs.nth(1).fill("100");
  await numberInputs.nth(2).fill("50");

  await page.getByRole("button", { name: "Remove inline repetition" }).click();
  await page.getByRole("button", { name: "Save item" }).click();

  // Re-open the saved item and confirm no inline repetition group carried through.
  await page.locator(".editor-search").fill(UNIQUE_ITEM);
  await page.locator(".editor-row", { hasText: UNIQUE_ITEM }).click();
  await expect(
    page.getByRole("button", { name: "Add inline repetition" }),
  ).toBeVisible();
  await expect(page.getByTestId("inline-repetition-fields")).toBeHidden();
});
