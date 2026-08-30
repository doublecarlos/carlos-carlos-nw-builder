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
  chooseClass,
  className,
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
  await chooseClass(page, "wizard");
  await expect(pickerInput(slotRow(page, "options.class"))).toHaveValue(
    className("wizard"),
  );

  const button = clearButton(page, "options");
  await button.click();
  await expect(button).toHaveText("Really?");
  await expect(pickerInput(slotRow(page, "options.class"))).toHaveValue(
    className("wizard"),
  );

  await button.click();
  // Empty, not "- none -": class is an item_picker since #273, and a cleared picker shows
  // nothing rather than a named empty option.
  await expect(pickerInput(slotRow(page, "options.class"))).toHaveValue("");
});

test("clearing a section is a single undo step", async ({ page }) => {
  await openBuilder(page);
  await ensureSectionExpanded(page, "options");
  await chooseClass(page, "wizard");

  const button = clearButton(page, "options");
  await button.click();
  await button.click();
  // Empty, not "- none -": class is an item_picker since #273, and a cleared picker shows
  // nothing rather than a named empty option.
  await expect(pickerInput(slotRow(page, "options.class"))).toHaveValue("");

  await undoButton(page).click();
  await expect(pickerInput(slotRow(page, "options.class"))).toHaveValue(
    className("wizard"),
  );
});
