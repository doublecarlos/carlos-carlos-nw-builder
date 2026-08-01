// End-to-end coverage for the quick-compare picker (App.vue's top bar) and the per-section
// "copy from another build" popover (SectionCopyMenu.vue) -- both need a second build in the
// picture, which slot-list.spec.ts deliberately stays away from.
import { test, expect } from "@playwright/test";
import {
  openBuilder,
  chooseItem,
  chooseCombo,
  headerRow,
  ensureSectionExpanded,
  slotRow,
  pickerInput,
  cursorRow,
} from "./support/app";

const HEAD_ITEM = "M29 Enchanted Depthweave Cap (CA)";

test("highlighting a diff and applying it copies the compare build's choice", async ({
  page,
}) => {
  await openBuilder(page);
  await chooseItem(page, "gear.head", HEAD_ITEM);

  await page.getByRole("button", { name: "+" }).first().click();
  await chooseCombo(page.locator(".compare-select"), "Build 1");
  await page.getByRole("checkbox", { name: "Highlight changes" }).check();

  const row = slotRow(page, "gear.head");
  await expect(row).toHaveClass(/is-diff/);
  await expect(row.locator(".slot-diff-note")).toContainText(HEAD_ITEM);

  await row.getByRole("button", { name: "apply" }).click();
  await expect(pickerInput(row)).toHaveValue(HEAD_ITEM);
  await expect(row).not.toHaveClass(/is-diff/);
});

test("copying a section from another build fills its slots", async ({
  page,
}) => {
  await openBuilder(page);
  await chooseItem(page, "gear.head", HEAD_ITEM);

  await page.getByRole("button", { name: "+" }).first().click();
  const gearHeader = headerRow(page, "gear");
  const copyBtn = gearHeader.locator("..").locator(".section-copy-btn");
  await copyBtn.click();

  const popover = page.locator(".copy-popover");
  await expect(popover).toBeVisible();
  await chooseCombo(popover.locator(".copy-popover-select"), "Build 1");
  await popover.getByRole("button", { name: "Copy" }).click();

  await expect(pickerInput(slotRow(page, "gear.head"))).toHaveValue(HEAD_ITEM);
});

test.describe("build_parameter compare diff apply", () => {
  test("a changed build_parameter row shows a diff note with an apply button", async ({
    page,
  }) => {
    // Build 1: set class to paladin via direct combobox click
    await openBuilder(page);
    const classRow = slotRow(page, "options.class");
    await headerRow(page, "options").click();
    await classRow.getByTestId("picker-input").click();
    await classRow.getByText("Paladin", { exact: true }).click();

    // Build 2: default warlock, compared against build 1
    await page.getByRole("button", { name: "+" }).first().click();
    await chooseCombo(page.locator(".compare-select"), "Build 1");
    await page.getByRole("checkbox", { name: "Highlight changes" }).check();
    await ensureSectionExpanded(page, "options");

    // Navigate to the class row (header:options → slot:options.class)
    await page.keyboard.press("ArrowDown");
    await expect(cursorRow(page)).toHaveAttribute(
      "data-cursor-key",
      "slot:options.class",
    );

    const row = slotRow(page, "options.class");
    await expect(row).toHaveClass(/is-diff/);

    // The diff note should show build 1's value and have an apply button
    await expect(row.locator(".slot-diff-note")).toContainText("Paladin");
    await expect(row.getByRole("button", { name: "apply" })).toBeVisible();
  });

  test("applying from compare copies the build_parameter value", async ({
    page,
  }) => {
    // Build 1: set class to paladin via direct combobox click
    await openBuilder(page);
    const classRow = slotRow(page, "options.class");
    await headerRow(page, "options").click();
    await classRow.getByTestId("picker-input").click();
    await classRow.getByText("Paladin", { exact: true }).click();

    // Build 2: default warlock, compared against build 1
    await page.getByRole("button", { name: "+" }).first().click();
    await chooseCombo(page.locator(".compare-select"), "Build 1");
    await page.getByRole("checkbox", { name: "Highlight changes" }).check();
    await ensureSectionExpanded(page, "options");

    // Navigate to the class row
    await page.keyboard.press("ArrowDown");

    const row = slotRow(page, "options.class");
    await expect(row).toHaveClass(/is-diff/);
    await expect(row.getByRole("button", { name: "apply" })).toBeVisible();

    // Click apply
    await row.getByRole("button", { name: "apply" }).click();

    // Should now match the compare build's value
    await expect(row.getByTestId("picker-input")).toHaveValue("Paladin");
    await expect(row).not.toHaveClass(/is-diff/);
  });
});
