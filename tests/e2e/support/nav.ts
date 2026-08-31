// Shared helpers for Nav.vue's sidebar -- build/layer rows, menu helpers, filter, and
// recently deleted.
import { expect, type Locator, type Page } from "@playwright/test";

export function buildRow(page: Page, name: string): Locator {
  return page.locator(".nav-row--build").filter({ hasText: name });
}

export function folderRow(page: Page, name: string): Locator {
  return page.locator(".nav-row--folder").filter({ hasText: name });
}

/** The wrapper a build row sits in, which carries the folder-nesting marker and the indent
 *  it draws -- one level up from `.nav-row--build` itself. */
export function buildRowNesting(page: Page, name: string): Locator {
  return buildRow(page, name).locator("xpath=..");
}

export function layerRow(page: Page, name: string): Locator {
  return page.locator(".nav-row--layer").filter({ hasText: name });
}

/** The sidebar rows currently drawing a drop line. Tailwind's `!` important prefix is matched
 *  as a class substring, so the selector needs no CSS escaping. */
export function dropIndicators(page: Page): Locator {
  return page
    .getByTestId("library")
    .locator('[class*="!border-t-accent"], [class*="!border-b-accent"]');
}

/** Opens a row's kebab menu and returns it (`.navmenu`), scoped so `getByText` only ever
 * matches within this one open menu. BasePopover teleports the menu to <body>, so the
 * menu is found globally rather than as a descendant of the row. */
export async function openRowMenu(row: Locator): Promise<Locator> {
  await row.locator(".nav-kebab").click();
  const menu = row.page().locator(".navmenu");
  await expect(menu).toBeVisible();
  return menu;
}

/** Clicks a danger action (Delete/Reset) twice -- the row's own two-step confirm turns the
 * label into "Really?" after the first click. */
export async function confirmDangerAction(menu: Locator, label: string) {
  const button = menu.getByRole("button", { name: label });
  await button.click();
  await menu.getByRole("button", { name: "Really?" }).click();
}

/** Renames via double-click. `input` is looked up from `page`, not `row` -- once rename mode
 * turns the row's button into an `<input>`, the name text moves into the input's *value*
 * (not its rendered text content), so a `row` locator built with `hasText` stops matching the
 * very row it just found. */
export async function renameViaSidebar(page: Page, row: Locator, name: string) {
  await row.locator(".nav-name").dblclick();
  const input = page.locator(".nav-rename");
  await input.fill(name);
  await input.press("Enter");
}

/** Clicks the "New" (plus-icon) button under the Builds section heading. */
export async function addBuild(page: Page) {
  await page.getByTestId("nav-add-build").click();
}

/** Clicks the "Folder" button under the Builds section heading. */
export async function addFolder(page: Page) {
  await page.getByTestId("nav-add-folder").click();
}

/** Clicks the "New" (plus-icon) button under the Customization Layers section heading. */
export async function addLayer(page: Page) {
  await page.getByTestId("nav-add-layer").click();
}

/** Enters a filter string in the Builds filter box. */
export async function filterBuilds(page: Page, text: string) {
  await page.getByTestId("nav-builds-filter").fill(text);
}

/** Enters a filter string in the Layers filter box. */
export async function filterLayers(page: Page, text: string) {
  await page.getByTestId("nav-layers-filter").fill(text);
}

/** Reorders a row up via Ctrl+↑ -- the row's keyboard-accessible reorder shortcut, now that
 *  drag-and-drop replaced the old Move up/down buttons. */
export async function moveUp(row: Locator) {
  await row.locator(".nav-name").focus();
  await row.page().keyboard.press("Control+ArrowUp");
}

/** Reorders a row down via Ctrl+↓ -- see `moveUp`. */
export async function moveDown(row: Locator) {
  await row.locator(".nav-name").focus();
  await row.page().keyboard.press("Control+ArrowDown");
}

/** Toggles the layer checkbox - clicks the checkbox input inside the layer row. */
export async function toggleLayerCheckbox(row: Locator) {
  await row.locator('input[type="checkbox"]').click();
}

/** Finds the Recently deleted section header. */
export function recentlyDeletedHeader(page: Page): Locator {
  return page.locator("text=Recently deleted").locator("..");
}

/** Expands Recently deleted and permanently deletes its first entry. */
export async function purgeFirstTrashEntry(page: Page) {
  await recentlyDeletedHeader(page).click();
  const menu = await openRowMenu(
    page.getByTestId("nav-trash").locator(".nav-row").first(),
  );
  await confirmDangerAction(menu, "Delete permanently");
}

/** Clicks the Restore button on a trash entry. */
export async function restoreTrash(page: Page) {
  await page
    .locator("text=Recently deleted")
    .locator("..")
    .locator("..")
    .getByRole("button", { name: "Restore" })
    .first()
    .click();
}
