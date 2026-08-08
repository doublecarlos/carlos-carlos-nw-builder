// End-to-end coverage for a section header's "clear section" control
// (SectionClearButton.vue) -- a two-step confirm that resets every slot in the section to
// its default.
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

function clearButton(page: Page, sectionId: string) {
  return headerRow(page, sectionId)
    .locator("..")
    .getByRole("button", { name: /Clear section|Really\?/ });
}

test("clearing a section requires a second click to confirm", async ({
  page,
}) => {
  await openBuilder(page);
  await ensureSectionExpanded(page, "options");
  await chooseCombo(slotRow(page, "options.class"), "Wizard");
  await expect(pickerInput(slotRow(page, "options.class"))).toHaveValue(
    "Wizard",
  );

  const button = clearButton(page, "options");
  await button.click();
  await expect(button).toHaveText("Really?");
  await expect(pickerInput(slotRow(page, "options.class"))).toHaveValue(
    "Wizard",
  );

  await button.click();
  await expect(pickerInput(slotRow(page, "options.class"))).toHaveValue(
    "— none —",
  );
});

test("clearing a section is a single undo step", async ({ page }) => {
  await openBuilder(page);
  await ensureSectionExpanded(page, "options");
  await chooseCombo(slotRow(page, "options.class"), "Wizard");

  const button = clearButton(page, "options");
  await button.click();
  await button.click();
  await expect(pickerInput(slotRow(page, "options.class"))).toHaveValue(
    "— none —",
  );

  await undoButton(page).click();
  await expect(pickerInput(slotRow(page, "options.class"))).toHaveValue(
    "Wizard",
  );
});
