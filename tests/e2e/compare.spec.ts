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
  assignmentInput,
  stepAssignment,
  parkCursorOnRow,
} from "./support/app";

const HEAD_ITEM = "M29 Enchanted Depthweave Cap (CA)";

test("highlighting a diff and applying it copies the compare build's choice", async ({
  page,
}) => {
  await openBuilder(page);
  await chooseItem(page, "gear.head", HEAD_ITEM);

  await page.getByTestId("nav-add-build").click();
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

  await page.getByTestId("nav-add-build").click();
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
    // Build 1: set role to Tank via direct combobox click. `options.role` is used rather than
    // `options.class` because this block is about a *build_parameter* row -- class became an
    // ordinary item_picker, and the item_picker case is covered above.
    await openBuilder(page);
    const roleRow = slotRow(page, "options.role");
    await roleRow.getByTestId("picker-input").click();
    await roleRow.getByText("Tank", { exact: true }).click();

    // Build 2: role unset, compared against build 1
    await page.getByTestId("nav-add-build").click();
    await chooseCombo(page.locator(".compare-select"), "Build 1");
    await page.getByRole("checkbox", { name: "Highlight changes" }).check();
    await ensureSectionExpanded(page, "options");

    // Park the cursor on the class row (native focus: nothing is focused yet, so the first
    // arrow key would have nowhere to start from -- a click parks it instead).
    await parkCursorOnRow(page, "options.role");
    await expect(cursorRow(page)).toHaveAttribute(
      "data-cursor-key",
      "slot:options.role",
    );

    const row = slotRow(page, "options.role");
    await expect(row).toHaveClass(/is-diff/);

    // The diff note should show build 1's value and have an apply button
    await expect(row.locator(".slot-diff-note")).toContainText("Tank");
    await expect(row.getByRole("button", { name: "apply" })).toBeVisible();
  });

  test("applying from compare copies the build_parameter value", async ({
    page,
  }) => {
    // Build 1: set role to Tank via direct combobox click. `options.role` is used rather than
    // `options.class` because this block is about a *build_parameter* row -- class became an
    // ordinary item_picker, and the item_picker case is covered above.
    await openBuilder(page);
    const roleRow = slotRow(page, "options.role");
    await roleRow.getByTestId("picker-input").click();
    await roleRow.getByText("Tank", { exact: true }).click();

    // Build 2: role unset, compared against build 1
    await page.getByTestId("nav-add-build").click();
    await chooseCombo(page.locator(".compare-select"), "Build 1");
    await page.getByRole("checkbox", { name: "Highlight changes" }).check();
    await ensureSectionExpanded(page, "options");

    // Park the cursor on the role row, same as the sibling test above.
    await parkCursorOnRow(page, "options.role");

    const row = slotRow(page, "options.role");
    await expect(row).toHaveClass(/is-diff/);
    await expect(row.getByRole("button", { name: "apply" })).toBeVisible();

    // Click apply
    await row.getByRole("button", { name: "apply" }).click();

    // Should now match the compare build's value
    await expect(row.getByTestId("picker-input")).toHaveValue("Tank");
    await expect(row).not.toHaveClass(/is-diff/);
  });
});

test.describe("point_assignment compare diff apply", () => {
  const SLOT_ID = "boons.tier1";
  const POWER_ID = "boon-tier1-power";

  test("a changed point_assignment row shows a diff note with an apply button", async ({
    page,
  }) => {
    // Build 1: spend a point on power
    await openBuilder(page);
    await stepAssignment(slotRow(page, SLOT_ID), POWER_ID, "increase");

    // Build 2: default (0 points), compared against build 1
    await page.getByTestId("nav-add-build").click();
    await chooseCombo(page.locator(".compare-select"), "Build 1");
    await page.getByRole("checkbox", { name: "Highlight changes" }).check();

    const row = slotRow(page, SLOT_ID);
    await expect(row).toHaveClass(/is-diff/);
    await expect(row.locator(".slot-diff-note")).toContainText("Power 1");
    await expect(row.getByRole("button", { name: "apply" })).toBeVisible();
  });

  test("applying from compare copies every row's count from the compare build", async ({
    page,
  }) => {
    // Build 1: spend a point on power
    await openBuilder(page);
    await stepAssignment(slotRow(page, SLOT_ID), POWER_ID, "increase");

    // Build 2: default (0 points), compared against build 1
    await page.getByTestId("nav-add-build").click();
    await chooseCombo(page.locator(".compare-select"), "Build 1");
    await page.getByRole("checkbox", { name: "Highlight changes" }).check();

    const row = slotRow(page, SLOT_ID);
    await expect(row).toHaveClass(/is-diff/);
    await row.getByRole("button", { name: "apply" }).click();

    await expect(assignmentInput(row, POWER_ID)).toHaveValue("1");
    await expect(row).not.toHaveClass(/is-diff/);
  });
});
