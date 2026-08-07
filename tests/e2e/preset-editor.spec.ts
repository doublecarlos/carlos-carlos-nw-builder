// End-to-end coverage for creating/editing/deleting a section preset through the Layer
// editor's "Presets" tab (PresetForm.vue), and confirming the result shows up live in the
// real build editor's "Preset..." menu (section-presets.spec.ts covers applying a *static*,
// developer-authored preset -- this covers the user-authored path on top of it).
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

test("creating a preset in a layer makes it available in the build's Preset menu", async ({
  page,
}) => {
  await openPresetsTab(page);
  await page.getByTestId("new-preset").click();

  await page.getByTestId("preset-label-input").fill("E2E Preset");
  await chooseCombo(page.getByTestId("preset-section-input"), "Options");

  await page.getByRole("button", { name: "Add a parameter" }).click();
  const row = page.locator(".preset-row").first();
  const slotPicker = row.locator(".relative", {
    has: page.getByPlaceholder("— pick a slot —"),
  });
  await chooseCombo(slotPicker, "Role");
  await chooseCombo(row.locator(".relative").last(), "DPS");

  await page.getByRole("button", { name: "Save preset" }).click();
  await expect(page.getByText('Saved preset "E2E Preset"')).toBeVisible();

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
    popover.getByRole("button", { name: "E2E Preset" }),
  ).toBeVisible();
  await popover.getByRole("button", { name: "E2E Preset" }).click();

  const roleRow = page.locator('[data-cursor-key="slot:options.role"]');
  await expect(roleRow.getByTestId("picker-input")).toHaveValue("DPS");
});

test("deleting a preset removes it from the build's Preset menu", async ({
  page,
}) => {
  await openPresetsTab(page);
  await page.getByTestId("new-preset").click();
  await page.getByTestId("preset-label-input").fill("Temp Preset");
  await chooseCombo(page.getByTestId("preset-section-input"), "Options");
  await page.getByRole("button", { name: "Add a parameter" }).click();
  const row = page.locator(".preset-row").first();
  await chooseCombo(
    row.locator(".relative", { has: page.getByPlaceholder("— pick a slot —") }),
    "Role",
  );
  await chooseCombo(row.locator(".relative").last(), "Healer");
  await page.getByRole("button", { name: "Save preset" }).click();
  await expect(page.getByText('Saved preset "Temp Preset"')).toBeVisible();

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
    popover.getByRole("button", { name: "Temp Preset" }),
  ).toBeHidden();
});
