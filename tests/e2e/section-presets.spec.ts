// End-to-end coverage for a section header's "apply a preset" popover (PresetMenu.vue),
// exercised against the real shipped `options` section presets (data/slots.json).
import { test, expect, type Page } from "@playwright/test";
import {
  openBuilder,
  headerRow,
  ensureSectionExpanded,
  slotRow,
  pickerInput,
  chooseCombo,
  undoButton,
} from "./support/app";

function presetMenu(page: Page, sectionId: string) {
  return headerRow(page, sectionId)
    .locator("..")
    .locator(".section-preset-btn");
}

test("applying a preset fills the slots it defines", async ({ page }) => {
  await openBuilder(page);
  await ensureSectionExpanded(page, "options");

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
  await ensureSectionExpanded(page, "options");

  // The "Healer" preset only sets role, not class -- set class first so we can prove it
  // survives the apply.
  await chooseCombo(slotRow(page, "options.class"), "Wizard");
  await expect(pickerInput(slotRow(page, "options.class"))).toHaveValue(
    "Wizard",
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
    "Wizard",
  );
});

test("applying a preset is a single undo step", async ({ page }) => {
  await openBuilder(page);
  await ensureSectionExpanded(page, "options");

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
