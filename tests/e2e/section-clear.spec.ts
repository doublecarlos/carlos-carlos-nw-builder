// End-to-end coverage for a section header's "clear section" control
// (SectionClearButton.vue), which resets every slot in the section and offers an undo notice
// rather than asking first.
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
    .getByRole("button", { name: "Clear", exact: true });
}

test("clearing a section acts at once and offers an undo notice", async ({
  page,
}) => {
  await openBuilder(page);
  await ensureSectionExpanded(page, "options");
  await chooseClass(page, "wizard");
  await expect(pickerInput(slotRow(page, "options.class"))).toHaveValue(
    className("wizard"),
  );

  await clearButton(page, "options").click();
  // Empty, not "- none -": class is an item_picker, and a cleared picker shows
  // nothing rather than a named empty option.
  await expect(pickerInput(slotRow(page, "options.class"))).toHaveValue("");

  // The notice takes it back, and goes with the action so it cannot fire twice.
  await expect(page.getByText("Cleared Options")).toBeVisible();
  await page.getByTestId("notice-action").click();
  await expect(pickerInput(slotRow(page, "options.class"))).toHaveValue(
    className("wizard"),
  );
  await expect(page.getByTestId("notice-action")).toHaveCount(0);
});

test("clearing a section is a single undo step", async ({ page }) => {
  await openBuilder(page);
  await ensureSectionExpanded(page, "options");
  await chooseClass(page, "wizard");

  await clearButton(page, "options").click();
  // Empty, not "- none -": class is an item_picker, and a cleared picker shows
  // nothing rather than a named empty option.
  await expect(pickerInput(slotRow(page, "options.class"))).toHaveValue("");

  await undoButton(page).click();
  await expect(pickerInput(slotRow(page, "options.class"))).toHaveValue(
    className("wizard"),
  );
});
