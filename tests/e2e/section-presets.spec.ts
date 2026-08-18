// End-to-end coverage for a section header's "apply a preset" popover (PresetMenu.vue).
// The `options` section ships with no developer-authored presets (data/slots.json), so each
// test authors its own through the Layer editor's "Presets" tab first -- the same
// user-authored path preset-editor.spec.ts covers in more depth.
import { test, expect, type Page } from "@playwright/test";
import {
  openBuilder,
  chooseCombo,
  headerRow,
  ensureSectionExpanded,
  slotRow,
  pickerInput,
  chooseClass,
  className,
  undoButton,
} from "./support/app";
import { addLayer, layerRow } from "./support/nav";

function presetMenu(page: Page, sectionId: string) {
  return headerRow(page, sectionId)
    .locator("..")
    .locator(".section-preset-btn");
}

/** Authors an Options-section preset via a fresh layer, setting one param per `[slotLabel,
 *  valueLabel]` pair, then switches back to "Build 1" with the section expanded and ready. */
async function createOptionsPreset(
  page: Page,
  label: string,
  params: [slotLabel: string, valueLabel: string][],
) {
  await addLayer(page);
  await layerRow(page, "Layer 1").locator(".nav-name").click();
  await page.getByRole("button", { name: /Presets \d+/ }).click();
  await page.getByTestId("new-preset").click();

  await page.getByTestId("preset-label-input").fill(label);
  await chooseCombo(page.getByTestId("preset-section-input"), "Options");

  for (const [slotLabel, valueLabel] of params) {
    await page.getByRole("button", { name: "Add a parameter" }).click();
    const row = page.locator(".preset-row").last();
    await chooseCombo(
      row.locator(".relative", {
        has: page.getByPlaceholder("— pick a slot —"),
      }),
      slotLabel,
    );
    await chooseCombo(row.locator(".relative").last(), valueLabel);
  }

  await page.getByRole("button", { name: "Save preset" }).click();
  await expect(page.getByText(`Saved preset "${label}"`)).toBeVisible();

  await page.getByRole("button", { name: "Build 1" }).click();
  await ensureSectionExpanded(page, "options");
}

test("applying a preset fills the slots it defines", async ({ page }) => {
  await openBuilder(page);
  await createOptionsPreset(page, "DPS (Magical)", [
    ["Role", "DPS"],
    ["Damage type", "Magical"],
  ]);

  await presetMenu(page, "options").click();
  const popover = page.locator(".preset-popover");
  await expect(popover).toBeVisible();
  await popover.getByRole("button", { name: "DPS (Magical)" }).click();

  await expect(pickerInput(slotRow(page, "options.role"))).toHaveValue("DPS");
  await expect(pickerInput(slotRow(page, "options.damageType"))).toHaveValue(
    "Magical",
  );
  await expect(popover).toBeHidden();
});

test("applying a preset leaves a slot it doesn't mention untouched", async ({
  page,
}) => {
  await openBuilder(page);
  await createOptionsPreset(page, "Healer", [["Role", "Healer"]]);

  // The "Healer" preset only sets role, not class -- set class first so we can prove it
  // survives the apply.
  await chooseClass(page, "wizard");
  await expect(pickerInput(slotRow(page, "options.class"))).toHaveValue(
    className("wizard"),
  );

  await presetMenu(page, "options").click();
  await page
    .locator(".preset-popover")
    .getByRole("button", { name: "Healer" })
    .click();

  await expect(pickerInput(slotRow(page, "options.role"))).toHaveValue(
    "Healer",
  );
  await expect(pickerInput(slotRow(page, "options.class"))).toHaveValue(
    className("wizard"),
  );
});

test("applying a preset is a single undo step", async ({ page }) => {
  await openBuilder(page);
  await createOptionsPreset(page, "DPS (Physical)", [
    ["Role", "DPS"],
    ["Damage type", "Physical"],
  ]);

  await presetMenu(page, "options").click();
  await page
    .locator(".preset-popover")
    .getByRole("button", { name: "DPS (Physical)" })
    .click();

  await expect(pickerInput(slotRow(page, "options.role"))).toHaveValue("DPS");
  await expect(pickerInput(slotRow(page, "options.damageType"))).toHaveValue(
    "Physical",
  );

  await undoButton(page).click();

  // "" is the empty choice, displayed as its own option's label, not a blank input.
  await expect(pickerInput(slotRow(page, "options.role"))).toHaveValue(
    "— none —",
  );
  await expect(pickerInput(slotRow(page, "options.damageType"))).toHaveValue(
    "— none —",
  );
});
