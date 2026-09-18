// End-to-end coverage for keyboard focus across every BaseMenu-built surface: NavContextMenu's
// kebab/Tools menus, CheckMenu's picker options, PresetMenu, and SectionCopyMenu. The mouse path
// for all four is covered elsewhere (nav.spec.ts, section-presets.spec.ts, compare.spec.ts,
// show-hidden-items.spec.ts) and stays untouched by this feature.
//
// Opening never pre-highlights a row, since native menus don't either. The first ArrowDown is
// what lands on item 1, not open() itself. SectionCopyMenu is the one exception: it has no
// arrow key of its own to fall back on, so its combobox is focused immediately.
import { test, expect } from "@playwright/test";
import {
  openBuilder,
  headerRow,
  ensureSectionExpanded,
  chooseItem,
  chooseCombo,
  slotRow,
  pickerInput,
} from "./support/app";
import { buildRow, addBuild, addLayer } from "./support/nav";

const HEAD_ITEM = "M29 Enchanted Depthweave Cap";

test.describe("NavContextMenu (build kebab)", () => {
  test("Enter on a Tab-focused kebab opens the menu, and ArrowDown focuses the first item", async ({
    page,
  }) => {
    await openBuilder(page);
    const row = buildRow(page, "Build 1");

    await row.locator(".nav-name").focus();
    await page.keyboard.press("Tab");
    await expect(row.locator(".nav-kebab")).toBeFocused();

    await page.keyboard.press("Enter");
    const menu = page.locator(".navmenu");
    await expect(menu).toBeVisible();

    await page.keyboard.press("ArrowDown");
    await expect(menu.getByRole("button", { name: "Rename" })).toBeFocused();
  });

  test("ArrowDown, ArrowDown, Enter activates the second item", async ({
    page,
  }) => {
    await openBuilder(page);
    const row = buildRow(page, "Build 1");
    await row.locator(".nav-kebab").click();

    const menu = page.locator(".navmenu");
    await expect(menu).toBeVisible();
    // Rename, Duplicate, ...: the first ArrowDown lands on Rename, the second on Duplicate.
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("ArrowDown");
    await expect(menu.getByRole("button", { name: "Duplicate" })).toBeFocused();
    await page.keyboard.press("Enter");

    await expect(buildRow(page, "Build 1 copy")).toBeVisible();
    await expect(menu).toBeHidden();
  });

  test("Escape closes the menu and returns focus to the kebab", async ({
    page,
  }) => {
    await openBuilder(page);
    const row = buildRow(page, "Build 1");
    const kebab = row.locator(".nav-kebab");
    await kebab.click();

    const menu = page.locator(".navmenu");
    await expect(menu).toBeVisible();
    await page.keyboard.press("Escape");

    await expect(menu).toBeHidden();
    await expect(kebab).toBeFocused();
  });

  test("Tab closes the menu and returns focus to the kebab", async ({
    page,
  }) => {
    await openBuilder(page);
    const row = buildRow(page, "Build 1");
    const kebab = row.locator(".nav-kebab");
    await kebab.click();

    const menu = page.locator(".navmenu");
    await expect(menu).toBeVisible();
    await page.keyboard.press("Tab");

    await expect(menu).toBeHidden();
    await expect(kebab).toBeFocused();
  });

  test("ArrowDown inside an open menu does not scroll the page", async ({
    page,
  }) => {
    await openBuilder(page);
    // A tall layers list gives the sidebar something to scroll, so a leaked ArrowDown would
    // show up as a real scrollY change rather than a no-op on an already-static page.
    for (let i = 0; i < 20; i++) await addLayer(page);

    await buildRow(page, "Build 1").locator(".nav-kebab").click();
    const menu = page.locator(".navmenu");
    await expect(menu).toBeVisible();

    const before = await page.evaluate(() => window.scrollY);
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("ArrowDown");
    const after = await page.evaluate(() => window.scrollY);
    expect(after).toBe(before);
  });
});

test("Header Tools menu: ArrowDown focuses its item, Escape returns focus to the button", async ({
  page,
}) => {
  await openBuilder(page);
  const trigger = page.getByTestId("header-tools");
  await trigger.click();

  const menu = page.locator(".navmenu");
  await expect(menu).toBeVisible();
  await page.keyboard.press("ArrowDown");
  await expect(menu.getByRole("button").first()).toBeFocused();

  await page.keyboard.press("Escape");
  await expect(menu).toBeHidden();
  await expect(trigger).toBeFocused();
});

test("picker options: ArrowDown focuses the first checkbox, and Space toggles it without closing", async ({
  page,
}) => {
  await openBuilder(page);
  const trigger = page.getByTestId("picker-options");
  await trigger.click();
  await page.keyboard.press("ArrowDown");

  // "Search items by stat" is the first row in pickerLens.OPTIONS, on by default.
  const firstCheckbox = page.getByTestId("picker-options:searchByStat");
  const checkbox = firstCheckbox.getByRole("checkbox");
  await expect(checkbox).toBeFocused();
  await expect(checkbox).toBeChecked();

  await page.keyboard.press("Space");
  await expect(checkbox).not.toBeChecked();
  await expect(checkbox).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(checkbox).toBeHidden();
});

test("Presets menu: ArrowDown focuses the first row, Escape returns focus to the button", async ({
  page,
}) => {
  await openBuilder(page);
  await ensureSectionExpanded(page, "options");
  const trigger = headerRow(page, "options")
    .locator("..")
    .locator(".section-preset-btn");
  await trigger.click();

  const popover = page.locator(".preset-popover");
  await expect(popover).toBeVisible();
  await page.keyboard.press("ArrowDown");
  await expect(popover.getByRole("button").first()).toBeFocused();

  await page.keyboard.press("Escape");
  await expect(popover).toBeHidden();
  await expect(trigger).toBeFocused();
});

test("Copy from menu opens with the combobox focused, and Escape returns focus to the button", async ({
  page,
}) => {
  await openBuilder(page);
  await addBuild(page);
  await ensureSectionExpanded(page, "gear");
  const trigger = headerRow(page, "gear")
    .locator("..")
    .locator(".section-copy-btn");
  await trigger.click();

  const popover = page.locator(".copy-popover");
  await expect(popover).toBeVisible();
  await expect(popover.getByTestId("picker-input")).toBeFocused();

  await page.keyboard.press("Escape");
  await expect(popover).toBeHidden();
  await expect(trigger).toBeFocused();
});

test("Copy from menu: Tab reaches the Copy button, and Enter confirms the copy", async ({
  page,
}) => {
  await openBuilder(page);
  await chooseItem(page, "gear.head", HEAD_ITEM);

  await addBuild(page);
  await ensureSectionExpanded(page, "gear");
  const trigger = headerRow(page, "gear")
    .locator("..")
    .locator(".section-copy-btn");
  await trigger.click();

  const popover = page.locator(".copy-popover");
  await chooseCombo(popover.locator(".copy-popover-select"), "Build 1");

  // Tab moves to the Copy button here instead of closing the menu, per SectionCopyMenu's
  // `dismiss-on-tab="false"`.
  await page.keyboard.press("Tab");
  await expect(popover.getByRole("button", { name: "Copy" })).toBeFocused();
  await page.keyboard.press("Enter");

  await expect(popover).toBeHidden();
  await expect(pickerInput(slotRow(page, "gear.head"))).toHaveValue(HEAD_ITEM);
});
