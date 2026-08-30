// End-to-end coverage for creating/editing/deleting a section preset through the Layer
// editor's "Presets" tab (PresetForm.vue), and confirming the result shows up live in the
// real build editor's "Preset..." menu (section-presets.spec.ts covers applying an already-
// authored preset through that menu -- this covers authoring it in the first place).
//
// Preset lookups in that menu are `exact` because each row's "update from current" button
// carries the preset's own name inside its label -- a substring match hits both.
import { test, expect, type Page } from "@playwright/test";
import {
  openBuilder,
  chooseCombo,
  headerRow,
  ensureSectionExpanded,
} from "./support/app";
import { addLayer, layerRow } from "./support/nav";

async function openPresetsTab(page: Page) {
  await openBuilder(page);
  await addLayer(page);
  await layerRow(page, "Layer 1").locator(".nav-name").click();
  await page.getByRole("button", { name: /Presets \d+/ }).click();
}

/** Fills out and saves a new Options-section preset with a single Role parameter. Assumes
 *  the Presets tab is already open and "New" has already been clicked for this preset. */
async function saveRolePreset(page: Page, label: string, roleValue: string) {
  await page.getByTestId("preset-label-input").fill(label);
  await chooseCombo(page.getByTestId("preset-section-input"), "Options");
  await page.getByRole("button", { name: "Add a parameter" }).click();
  const row = page.locator(".preset-row").first();
  await chooseCombo(
    row.locator(".relative", { has: page.getByPlaceholder("- pick a slot -") }),
    "Role",
  );
  await chooseCombo(row.locator(".relative").last(), roleValue);
  await page.getByRole("button", { name: "Save preset" }).click();
  await expect(page.getByText(`Saved preset "${label}"`)).toBeVisible();
}

test("creating a preset in a layer makes it available in the build's Preset menu", async ({
  page,
}) => {
  await openPresetsTab(page);
  await page.getByTestId("new-preset").click();
  await saveRolePreset(page, "E2E Preset", "DPS");

  // Back to the build: the new preset shows up in the Options section's menu, and applying
  // it sets role the same way a static preset does (section-presets.spec.ts).
  await page.getByRole("button", { name: "Build 1" }).click();
  await ensureSectionExpanded(page, "options");
  const presetBtn = headerRow(page, "options")
    .locator("..")
    .locator(".section-preset-btn");
  await presetBtn.click();
  const popover = page.locator(".preset-popover");
  await expect(
    popover.getByRole("button", { name: "E2E Preset", exact: true }),
  ).toBeVisible();
  await popover
    .getByRole("button", { name: "E2E Preset", exact: true })
    .click();

  const roleRow = page.locator('[data-cursor-key="slot:options.role"]');
  await expect(roleRow.getByTestId("picker-input")).toHaveValue("DPS");
});

test("deleting a preset removes it from the build's Preset menu, leaving the others", async ({
  page,
}) => {
  await openPresetsTab(page);

  // A second preset stays behind after the delete -- proves the delete removed just the one
  // preset, not the whole menu (which would also disappear if it were the section's last one).
  await page.getByTestId("new-preset").click();
  await saveRolePreset(page, "Keep Preset", "Tank");

  await page.getByTestId("new-preset").click();
  await saveRolePreset(page, "Temp Preset", "Healer");

  await page.getByRole("button", { name: "Delete" }).click();
  await expect(page.getByText('Removed preset "temp-preset"')).toBeVisible();

  await page.getByRole("button", { name: "Build 1" }).click();
  await ensureSectionExpanded(page, "options");
  const presetBtn = headerRow(page, "options")
    .locator("..")
    .locator(".section-preset-btn");
  await presetBtn.click();
  const popover = page.locator(".preset-popover");
  await expect(
    popover.getByRole("button", { name: "Temp Preset", exact: true }),
  ).toBeHidden();
  await expect(
    popover.getByRole("button", { name: "Keep Preset", exact: true }),
  ).toBeVisible();
});
