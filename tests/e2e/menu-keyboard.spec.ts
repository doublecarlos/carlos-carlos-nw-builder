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
  ensureSectionExpanded,
  slotRow,
  pickerInput,
} from "./support/app";
import { buildRow, addBuild, addLayer } from "./support/nav";
import { importTestCatalog } from "./support/testCatalog";

const HEAD_ID = "test-copy-head";
const HEAD_ITEM = "Test Copy Head";
const SOURCE_BUILD = "Test copy source";

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
  const trigger = page.getByTestId("section-actions-options");
  await trigger.click();

  const popover = page.getByTestId("section-actions-panel");
  await expect(popover).toBeVisible();
  await page.keyboard.press("ArrowDown");
  await expect(popover.getByRole("button").first()).toBeFocused();

  await page.keyboard.press("Escape");
  await expect(popover).toBeHidden();
  await expect(trigger).toBeFocused();
});

test("Section menu: a second list keeps the keyboard, and Enter copies from the chosen build", async ({
  page,
}) => {
  await openBuilder(page);
  await importTestCatalog(page, {
    name: SOURCE_BUILD,
    items: [{ id: HEAD_ID, name: HEAD_ITEM, filter: "gear_head" }],
    choices: { "gear.head": HEAD_ID },
  });

  await addBuild(page);
  await ensureSectionExpanded(page, "gear");
  const trigger = page.getByTestId("section-actions-gear");
  await trigger.click();
  const panel = page.getByTestId("section-actions-panel");

  // The entry that opened the build list is gone, so focus lands on the new list's first entry.
  await panel.getByTestId("section-actions-copy").focus();
  await page.keyboard.press("Enter");
  await expect(panel.getByTestId("section-actions-back")).toBeFocused();
  // Arrows step through the builds as in any menu.
  const source = panel.getByRole("button", { name: SOURCE_BUILD, exact: true });
  await expect
    .poll(async () => {
      await page.keyboard.press("ArrowDown");
      return source.evaluate((el) => el === document.activeElement);
    })
    .toBe(true);
  await page.keyboard.press("Enter");

  await expect(panel).toBeHidden();
  await expect(pickerInput(slotRow(page, "gear.head"))).toHaveValue(HEAD_ITEM);
});
