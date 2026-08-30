// End-to-end coverage for authoring a `BonusOccurrenceConfig` attachment in the item editor:
// an attached bonus starts as a plain id (always 1 occurrence) and can be upgraded to
// a typed min/max/default occurrence count, same "hidden until added, fully removable"
// convention item-editor-groups.spec.ts already covers for dynamic modification/point
// assignment. The occurrence editor only appears once the bonus itself has a real id -- a
// brand-new, not-yet-saved bonus is still a "pending" slot with nothing to attach a config to.
// Also covers the optional `label` field, which overrides the bonus name on this
// attachment's build-editor row.
import { test, expect, type Page } from "@playwright/test";
import { openBuilder } from "./support/app";
import { addLayer, layerRow } from "./support/nav";

const UNIQUE_ITEM = "ZZZ Test Occurrence Item";
const UNIQUE_BONUS = "ZZZ Test Occurrence Bonus";

/** Creates a brand-new item draft with one freshly-saved private bonus attached, leaving the
 *  item form open (item itself still unsaved) for further edits. */
async function openItemFormWithAttachedBonus(page: Page) {
  await openBuilder(page);
  await addLayer(page);
  await layerRow(page, "Layer 1").locator(".nav-name").click();
  await page.getByTestId("new-item").click();
  await page.getByTestId("item-name-input").fill(UNIQUE_ITEM);
  await page.getByTestId("item-filter-input").fill("gear_head");

  await page.getByLabel("Add bonus").click();
  await page.getByTestId("bonus-name-input").fill(UNIQUE_BONUS);
  await page.getByRole("button", { name: "Save bonus" }).click();
}

test("occurrence config is hidden until added, then fully removable", async ({
  page,
}) => {
  await openItemFormWithAttachedBonus(page);

  const row = page.getByTestId("occurrence-config-row");
  await expect(row).toBeVisible();
  await expect(row).toContainText("default (1 per item copy)");
  await expect(row.getByTestId("occurrence-config-fields")).toBeHidden();

  await row.getByTestId("add-occurrence-config").click();
  const fields = row.getByTestId("occurrence-config-fields");
  await expect(fields).toBeVisible();
  await expect(row.getByTestId("remove-occurrence-config")).toBeVisible();

  const numberInputs = fields.locator('input[type="number"]');
  await numberInputs.nth(0).fill("0"); // Min
  await numberInputs.nth(1).fill("5"); // Max
  await numberInputs.nth(2).fill("2"); // Default

  await row.getByTestId("remove-occurrence-config").click();

  await expect(fields).toBeHidden();
  await expect(row).toContainText("default (1 per item copy)");
  await expect(row.getByTestId("add-occurrence-config")).toBeVisible();

  // Re-adding must not resurrect the values that were just cleared.
  await row.getByTestId("add-occurrence-config").click();
  await expect(numberInputs.nth(0)).toHaveValue("");
  await expect(numberInputs.nth(1)).toHaveValue("");
  await expect(numberInputs.nth(2)).toHaveValue("");
});

test("a saved occurrence config, including its label, survives a save and reopen", async ({
  page,
}) => {
  await openItemFormWithAttachedBonus(page);

  const row = page.getByTestId("occurrence-config-row");
  await row.getByTestId("add-occurrence-config").click();
  const fields = row.getByTestId("occurrence-config-fields");
  const numberInputs = fields.locator('input[type="number"]');
  await numberInputs.nth(0).fill("0");
  await numberInputs.nth(1).fill("5");
  await numberInputs.nth(2).fill("2");
  await fields.getByTestId("occurrence-config-label-input").fill("Stacks");

  await page.getByRole("button", { name: "Save item" }).click();

  await page.locator(".editor-search").fill(UNIQUE_ITEM);
  await page.locator(".editor-row", { hasText: UNIQUE_ITEM }).click();

  const reopenedRow = page.getByTestId("occurrence-config-row");
  const reopenedFields = reopenedRow.getByTestId("occurrence-config-fields");
  await expect(reopenedFields).toBeVisible();
  const reopenedInputs = reopenedFields.locator('input[type="number"]');
  await expect(reopenedInputs.nth(0)).toHaveValue("0");
  await expect(reopenedInputs.nth(1)).toHaveValue("5");
  await expect(reopenedInputs.nth(2)).toHaveValue("2");
  await expect(
    reopenedFields.getByTestId("occurrence-config-label-input"),
  ).toHaveValue("Stacks");
});

test("an empty label is not persisted as a saved field", async ({ page }) => {
  await openItemFormWithAttachedBonus(page);

  const row = page.getByTestId("occurrence-config-row");
  await row.getByTestId("add-occurrence-config").click();
  const fields = row.getByTestId("occurrence-config-fields");
  await fields.locator('input[type="number"]').nth(1).fill("5"); // Max

  await page.getByRole("button", { name: "Save item" }).click();

  await page.locator(".editor-search").fill(UNIQUE_ITEM);
  await page.locator(".editor-row", { hasText: UNIQUE_ITEM }).click();

  const reopenedFields = page
    .getByTestId("occurrence-config-row")
    .getByTestId("occurrence-config-fields");
  await expect(
    reopenedFields.getByTestId("occurrence-config-label-input"),
  ).toHaveValue("");
});
