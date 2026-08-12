// End-to-end coverage for removing an item's dynamic modification / inline repetition
// groups in the item editor: both start hidden behind an "add" button, like Stats, and a
// trash button clears the whole group back to unset rather than leaving stale values
// behind that a disabled/empty-looking field can't fully clean up.
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

test("dynamic modification group is hidden until added, then fully removable", async ({
  page,
}) => {
  await openNewItemForm(page);

  await expect(
    page.getByRole("button", { name: "Add dynamic modification" }),
  ).toBeVisible();
  await expect(page.getByTestId("dynamic-modification-fields")).toBeHidden();

  await page.getByRole("button", { name: "Add dynamic modification" }).click();
  const fields = page.getByTestId("dynamic-modification-fields");
  await expect(fields).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Remove dynamic modification" }),
  ).toBeVisible();

  const statPicker = fields.getByTestId("picker-input");
  const numberInputs = fields.locator('input[type="number"]');
  await statPicker.click();
  await statPicker.fill("Item Level");
  await fields.getByText("Item Level", { exact: true }).click();
  await numberInputs.nth(0).fill("10"); // Min
  await numberInputs.nth(1).fill("20"); // Max

  await page
    .getByRole("button", { name: "Remove dynamic modification" })
    .click();

  await expect(fields).toBeHidden();
  await expect(
    page.getByRole("button", { name: "Add dynamic modification" }),
  ).toBeVisible();

  // Re-adding must not resurrect the values that were just cleared.
  await page.getByRole("button", { name: "Add dynamic modification" }).click();
  await expect(statPicker).toHaveValue("");
  await expect(numberInputs.nth(0)).toHaveValue("");
  await expect(numberInputs.nth(1)).toHaveValue("");
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
