// End-to-end coverage for the bonus editor's own "Dynamic stats" sections (grant- and
// variant-level dynamic stats), mirroring item-editor-groups.spec.ts's item-level
// coverage. Before this, a grant or variant carrying `dynamicStats` had no widget and was
// always forced into the JSON escape hatch.
import { test, expect, type Page } from "@playwright/test";
import { openBuilder } from "./support/app";
import { addLayer, layerRow } from "./support/nav";

/** Opens a fresh layer, switches to its Bonuses tab, and starts a new (unsaved) bonus --
 *  enough to reach BonusRows.vue's grants list without needing to save anything. */
async function openNewBonus(page: Page) {
  await openBuilder(page);
  await addLayer(page);
  await layerRow(page, "Layer 1").locator(".nav-name").click();
  await page.getByRole("button", { name: /Bonuses \d+/ }).click();
  await page.getByTestId("new-bonus").click();
}

test("a flat grant's dynamic stat rows can be added and removed without forcing JSON mode", async ({
  page,
}) => {
  await openNewBonus(page);
  await page.getByTestId("bonus-name-input").fill("ZZZ Test Dynamic Bonus");
  await page.getByLabel("Add grant").click();

  const grant = page.getByTestId("bonus-grant-row").first();
  const rows = grant.locator(".dynamic-stat-row");
  await expect(rows).toHaveCount(1); // the empty "Add" row

  await grant.getByRole("button", { name: "Add dynamic stat" }).first().click();
  await expect(rows).toHaveCount(1);

  const row = rows.last();
  const statPicker = row.getByTestId("picker-input");
  const numberInputs = row.locator('input[type="number"]');
  await statPicker.click();
  await statPicker.fill("Item Level");
  await row.getByText("Item Level", { exact: true }).click();
  await numberInputs.nth(0).fill("0"); // Min
  await numberInputs.nth(1).fill("5"); // Max
  await numberInputs.nth(2).fill("3"); // Default

  // The grant stays in the form -- the JSON toggle still offers to switch *into* JSON, it
  // hasn't already switched there on its own.
  await expect(grant.getByLabel("Edit as JSON")).toBeVisible();

  await row.getByRole("button", { name: "Remove dynamic stat" }).click();
  await expect(rows).toHaveCount(1);
  await grant.getByRole("button", { name: "Add dynamic stat" }).first().click();
  await expect(rows.last().getByTestId("picker-input")).toHaveValue("");
});

test("a variant's own dynamic stat rows are independent of the grant's flat ones", async ({
  page,
}) => {
  await openNewBonus(page);
  await page.getByTestId("bonus-name-input").fill("ZZZ Test Variant Dynamic");
  await page.getByLabel("Add grant").click();

  const grant = page.getByTestId("bonus-grant-row").first();
  await grant.getByText("varies by condition").click();

  const variant = page.getByTestId("bonus-variant-row").first();
  const variantRows = variant.locator(".dynamic-stat-row");
  await expect(variantRows).toHaveCount(1);

  await variant
    .getByRole("button", { name: "Add dynamic stat" })
    .first()
    .click();
  const row = variantRows.last();
  const statPicker = row.getByTestId("picker-input");
  await statPicker.click();
  await statPicker.fill("Item Level");
  await row.getByText("Item Level", { exact: true }).click();
  await row.locator('input[type="number"]').nth(2).fill("2"); // Default

  // Still form-editable, not forced to JSON.
  await expect(grant.getByLabel("Edit as JSON")).toBeVisible();
  await expect(row.getByTestId("picker-input")).toHaveValue("Item Level");
});
