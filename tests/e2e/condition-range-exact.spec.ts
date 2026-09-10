// End-to-end coverage for the range ("at least"/"below") vs "exact" comparison toggle on
// duration/bonusOccurrences/equipped/param conditions.
// `equipped`/`bonusOccurrences` already showed a "Below" field before this, but
// condition-draft.ts never read or wrote it -- typing into it silently did nothing. This
// spec exercises that field for real, plus the newly added "exact" comparison mode.
import { test, expect, type Page, type Locator } from "@playwright/test";
import { openBuilder } from "./support/app";
import { addLayer, layerRow } from "./support/nav";

/** Opens a fresh layer, switches to its Bonuses tab, starts a new (unsaved) bonus, adds one
 *  grant, and adds one condition leaf -- enough to reach the leaf's own comparison fields. */
async function openNewConditionLeaf(page: Page) {
  await openBuilder(page);
  await addLayer(page);
  await layerRow(page, "Layer 1").locator(".nav-name").click();
  await page.getByRole("button", { name: /Bonuses \d+/ }).click();
  await page.getByTestId("new-bonus").click();
  await page.getByLabel("Add grant").click();
  await page.getByLabel("Add condition").click();
  return page.getByTestId("condition-row").first();
}

async function setLeafType(row: Locator, type: string) {
  await row.getByTestId("picker-input").first().click();
  await row.getByText(type, { exact: true }).click();
}

test("an equipped leaf's below bound is actually saved, not silently dropped", async ({
  page,
}) => {
  const row = await openNewConditionLeaf(page);
  await setLeafType(row, "equipped");

  // A count leaf opens unbounded: "at least 1" is the engine's own reading of a leaf with no
  // range, so the mode that writes nothing is the default and shows no fields at all.
  await expect(
    row.getByRole("button", { name: "at least 1", exact: true }),
  ).toBeVisible();
  await expect(row.locator('input[type="number"]')).toHaveCount(0);

  await row.getByRole("button", { name: "range", exact: true }).click();
  const numberInputs = row.locator('input[type="number"]');
  await expect(numberInputs).toHaveCount(2);

  await row
    .locator('input[type="text"]:not([data-testid="picker-input"])')
    .first()
    .fill("ring_of_x");
  await numberInputs.nth(0).fill("2");
  await numberInputs.nth(1).fill("4"); // Below

  // Never forced into the JSON escape hatch by this leaf shape.
  const grant = page.getByTestId("bonus-grant-row").first();
  await expect(grant.getByLabel("Edit as JSON")).toBeVisible();

  // Flip to JSON and read the serialized shape directly -- the most direct proof the "Below"
  // value actually made it into the saved condition instead of vanishing.
  await grant.getByLabel("Edit as JSON").click();
  const json = await grant.locator("textarea").inputValue();
  expect(json).toContain('"tag": "ring_of_x"');
  expect(json).toContain('"atLeast": 2');
  expect(json).toContain('"below": 4');
});

// The unbounded mode is what an explicit `atLeast: 1` in the data normalizes to, so it has to
// round-trip as writing no range rather than as writing the default back out.
test("a count leaf left unbounded saves no range at all", async ({ page }) => {
  const row = await openNewConditionLeaf(page);
  await setLeafType(row, "equipped");
  await row
    .locator('input[type="text"]:not([data-testid="picker-input"])')
    .first()
    .fill("ring_of_x");

  const grant = page.getByTestId("bonus-grant-row").first();
  await grant.getByLabel("Edit as JSON").click();
  const json = await grant.locator("textarea").inputValue();
  expect(json).toContain('"tag": "ring_of_x"');
  expect(json).not.toContain('"atLeast"');
  expect(json).not.toContain('"below"');
});

test("switching a condition between range and exact comparison resets the other mode's fields", async ({
  page,
}) => {
  const row = await openNewConditionLeaf(page);
  await setLeafType(row, "duration");

  const rangeInputs = row.locator('input[type="number"]');
  await expect(rangeInputs).toHaveCount(2); // At least (s) / Below (s)
  await rangeInputs.nth(0).fill("10");
  await rangeInputs.nth(1).fill("30");

  await row.getByRole("button", { name: "exact", exact: true }).click();
  await expect(row.locator('input[type="number"]')).toHaveCount(1); // Exactly (s)
  await expect(row.locator('input[type="number"]')).toHaveValue("");
  await row.locator('input[type="number"]').fill("15");

  await row.getByRole("button", { name: "range", exact: true }).click();
  const rangeInputsAgain = row.locator('input[type="number"]');
  await expect(rangeInputsAgain).toHaveCount(2);
  await expect(rangeInputsAgain.nth(0)).toHaveValue("");
  await expect(rangeInputsAgain.nth(1)).toHaveValue("");
});
