// End-to-end coverage for the quick-compare picker (App.vue's top bar) and the per-section
// "copy from another build" popover (SectionCopyMenu.vue) -- both need a second build in the
// picture, which slot-list.spec.ts deliberately stays away from.
import { test, expect, type Page } from "@playwright/test";
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
import {
  addBuild,
  addFolder,
  buildRow,
  folderRow,
  openRowMenu,
  renameViaSidebar,
} from "./support/nav";

const HEAD_ITEM = "M29 Enchanted Depthweave Cap";

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

test.describe("folder names in the build pickers", () => {
  /** Two builds, "Build 1" filed under an "Alts" folder and "Build 2" active at the top
   *  level -- the sidebar is the only place that grouping normally shows. */
  async function buildInAFolder(page: Page) {
    await openBuilder(page);
    await addBuild(page);
    await addFolder(page);
    await renameViaSidebar(page, folderRow(page, "Folder 1"), "Alts");
    const menu = await openRowMenu(buildRow(page, "Build 1"));
    await menu.getByRole("button", { name: "Move to “Alts”" }).click();
    await expect(buildRow(page, "Build 1")).toBeVisible();
  }

  test("the compare picker heads a folder's builds, and keeps the folder once chosen", async ({
    page,
  }) => {
    await buildInAFolder(page);
    const combo = page.locator(".compare-select");

    await pickerInput(combo).click();
    await expect(combo.getByTestId("picker-group")).toHaveText("Alts");
    // The heading carries the folder, so the row itself is just the name.
    const row = combo
      .getByTestId("picker-option")
      .filter({ hasText: "Build 1" });
    await expect(row).toHaveText("Build 1");

    await row.click();
    // Closing the list must not throw the disambiguation away.
    await expect(pickerInput(combo)).toHaveValue("Alts · Build 1");
  });

  test("a top-level build is listed under no heading at all", async ({
    page,
  }) => {
    await buildInAFolder(page);
    // Look from the filed build, so the top-level one is what the picker offers.
    await buildRow(page, "Build 1").click();
    const combo = page.locator(".compare-select");

    await pickerInput(combo).click();

    await expect(
      combo.getByTestId("picker-option").filter({ hasText: "Build 2" }),
    ).toBeVisible();
    await expect(combo.getByTestId("picker-group")).toHaveCount(0);
  });

  test("a heading is passed over rather than landed on", async ({ page }) => {
    await buildInAFolder(page);
    const combo = page.locator(".compare-select");

    await pickerInput(combo).click();
    // Rows are "- none -", the "Alts" heading, then "Build 1": one step down has to reach
    // the build, not stop on a heading Enter would do nothing with.
    await pickerInput(combo).press("ArrowDown");
    await pickerInput(combo).press("Enter");

    await expect(pickerInput(combo)).toHaveValue("Alts · Build 1");
  });

  test("typing a folder name narrows the picker to its builds", async ({
    page,
  }) => {
    await buildInAFolder(page);
    const combo = page.locator(".compare-select");

    await pickerInput(combo).click();
    await pickerInput(combo).fill("Alts");

    await expect(
      combo.getByTestId("picker-option").filter({ hasText: "Build 1" }),
    ).toBeVisible();
    // The heading only appears above builds that survived the filter.
    await expect(combo.getByTestId("picker-group")).toHaveText("Alts");
  });

  test("a name too long for the field widens the dropdown, into the panel", async ({
    page,
  }) => {
    await buildInAFolder(page);
    await renameViaSidebar(
      page,
      buildRow(page, "Build 1"),
      "ST Jotunskar Hellbringer M33",
    );
    await buildRow(page, "Build 2").click();
    const combo = page.locator(".compare-select");
    await pickerInput(combo).click();

    // The compare picker's field is a narrow stat-panel table cell, so the menu takes its
    // own width rather than truncating every name to the cell.
    const inputBox = await pickerInput(combo).boundingBox();
    const menuBox = await combo.getByTestId("picker-menu").boundingBox();
    expect(menuBox!.width).toBeGreaterThan(inputBox!.width);

    // The stat panel is a rail whose scroller clips horizontally, so the menu has to grow
    // rightward into it: growing leftward would put the rows' text outside the clip.
    const panelBox = await page.getByTestId("stat-panel-column").boundingBox();
    expect(menuBox!.x).toBeGreaterThanOrEqual(panelBox!.x);
    expect(menuBox!.x + menuBox!.width).toBeLessThanOrEqual(
      panelBox!.x + panelBox!.width,
    );
  });

  test("the section copy popover groups by folder too", async ({ page }) => {
    await buildInAFolder(page);
    const gearHeader = headerRow(page, "gear");
    await gearHeader.locator("..").locator(".section-copy-btn").click();

    const combo = page.locator(".copy-popover").locator(".copy-popover-select");
    await pickerInput(combo).click();

    await expect(combo.getByTestId("picker-group")).toHaveText("Alts");
    await expect(
      combo.getByTestId("picker-option").filter({ hasText: "Build 1" }),
    ).toHaveText("Build 1");
  });
});
