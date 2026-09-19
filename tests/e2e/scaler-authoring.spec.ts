// End-to-end coverage for authoring scalers in the layer editor: a grant's "scaled by" picker
// and a parameter's scaler block both persist through the form and come back on reopen.
import { test, expect, type Page } from "@playwright/test";
import { openBuilder, chooseCombo } from "./support/app";
import { addLayer, layerRow } from "./support/nav";

const BONUS = "ZZZ Test Scaled Bonus";

/** Creates a layer and selects it, leaving the editor on its default tab. */
async function openLayer(page: Page) {
  await openBuilder(page);
  await addLayer(page);
  await layerRow(page, "Layer 1").locator(".nav-name").click();
}

async function openEditorRow(page: Page, text: string) {
  await page.locator(".editor-search").fill(text);
  await page.locator(".editor-row", { hasText: text }).first().click();
}

test("a grant's scaler is picked from the scaler parameters and survives reopening", async ({
  page,
}) => {
  await openLayer(page);
  await page.getByRole("button", { name: /Bonuses \d+/ }).click();
  await page.getByTestId("new-bonus").click();
  await page.getByTestId("bonus-name-input").fill(BONUS);
  await page.getByLabel("Add grant").click();

  const picker = page.getByTestId("grant-scaled-by");
  await expect(picker.getByTestId("picker-input")).toHaveValue("not scaled");
  await chooseCombo(picker, "Encounter Damage");
  await expect(picker.getByTestId("picker-input")).toHaveValue(
    "Encounter Damage",
  );
  await page.getByRole("button", { name: "Save bonus" }).click();

  // Leave for another bonus and come back: the reopened form is rebuilt from what was saved.
  await openEditorRow(page, "Risky Investment");
  await expect(page.getByTestId("bonus-name-input")).toHaveValue(
    "Risky Investment",
  );
  await openEditorRow(page, BONUS);
  await expect(page.getByTestId("bonus-name-input")).toHaveValue(BONUS);
  await expect(picker.getByTestId("picker-input")).toHaveValue(
    "Encounter Damage",
  );
});

test("a parameter's scaler mode and filters are editable and survive reopening", async ({
  page,
}) => {
  await openLayer(page);
  await page.getByTestId("tab-slots").click();

  // Mount bolster ships as a relative scaler over the two mount filters.
  await openEditorRow(page, "Mount bolster");
  const mode = page.getByTestId("slot-scaler-mode-input");
  await expect(mode.getByTestId("picker-input")).toHaveValue(
    "relative (1 + value)",
  );
  await expect(page.getByTestId("slot-scaler-filters-input")).toHaveValue(
    "mount_combat, mount_equip",
  );

  await chooseCombo(mode, "absolute (value as-is)");
  await page.getByTestId("slot-scaler-filters-input").fill("mount_combat");
  await page.getByTestId("slot-scaler-tags-input").fill("mount");

  await openEditorRow(page, "Companion bolster");
  await expect(page.getByTestId("slot-label-input")).toHaveValue(
    "Companion bolster",
  );
  await openEditorRow(page, "Mount bolster");
  await expect(mode.getByTestId("picker-input")).toHaveValue(
    "absolute (value as-is)",
  );
  await expect(page.getByTestId("slot-scaler-filters-input")).toHaveValue(
    "mount_combat",
  );
  await expect(page.getByTestId("slot-scaler-tags-input")).toHaveValue("mount");

  // A boolean parameter cannot be a scaler, so the controls are not offered for one.
  await chooseCombo(page.getByTestId("slot-type-input"), "boolean");
  await expect(mode).toHaveCount(0);
});
