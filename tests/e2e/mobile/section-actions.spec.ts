// A section header's actions on a phone: one menu whose entries say what they do. Desktop uses
// the same menu; its keyboard and copy flows are covered in menu-keyboard and compare specs.
import { test, expect, type Page } from "@playwright/test";
import {
  openBuilder,
  ensureSectionExpanded,
  slotRow,
  pickerInput,
  chooseClass,
  className,
} from "../support/app";
import { openDrawer } from "../support/nav";

const actions = (page: Page, sectionId: string) =>
  page.getByTestId(`section-actions-${sectionId}`);

test("a section header has one labeled actions menu", async ({ page }) => {
  await openBuilder(page);
  await expect(page.getByTestId("clear-section-options")).toHaveCount(0);
  await actions(page, "options").click();
  await expect(
    page.getByRole("button", { name: "Save as new preset" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Reset to defaults" }),
  ).toBeVisible();
});

test("reset to defaults clears the section from the menu", async ({ page }) => {
  await openBuilder(page);
  await ensureSectionExpanded(page, "options");
  await chooseClass(page, "wizard");

  await actions(page, "options").click();
  await page.getByTestId("clear-section-options").click();
  await expect(pickerInput(slotRow(page, "options.class"))).toHaveValue("");
});

test("copy from another build picks the build in a second list", async ({
  page,
}) => {
  await openBuilder(page);
  await ensureSectionExpanded(page, "options");
  await chooseClass(page, "wizard");
  await openDrawer(page);
  await page.getByTestId("nav-add-build").click();
  await ensureSectionExpanded(page, "options");
  await expect(pickerInput(slotRow(page, "options.class"))).toHaveValue("");

  await actions(page, "options").click();
  await page.getByTestId("section-actions-copy").click();
  // The second list has a way back, and lists the builds to copy from.
  await expect(page.getByTestId("section-actions-back")).toBeVisible();
  await page.locator('[data-testid^="section-actions-copy-"]').first().click();
  await expect(pickerInput(slotRow(page, "options.class"))).toHaveValue(
    className("wizard"),
  );
});
