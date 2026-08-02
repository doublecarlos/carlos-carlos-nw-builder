// Shared helpers for Nav.vue's sidebar -- build/layer rows, menu helpers, filter, and
// recently deleted.
import { expect, type Locator, type Page } from "@playwright/test";

export function buildRow(page: Page, name: string): Locator {
  return page.locator(".nav-row--build").filter({ hasText: name });
}

export function layerRow(page: Page, name: string): Locator {
  return page.locator(".nav-row--layer").filter({ hasText: name });
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

/** Clicks the "New" (plus-icon) button under the Customization Layers section heading. */
export async function addLayer(page: Page) {
  await page.getByTestId("nav-add-layer").click();
}

/** Enters a filter string in the Builds filter box. */
export async function filterBuilds(page: Page, text: string) {
  // The builds filter is the first input[placeholder="Filter…"] in the nav.
  const filter = page.locator('input[placeholder="Filter…"]').first();
  await filter.fill(text);
}

/** Enters a filter string in the Layers filter box. */
export async function filterLayers(page: Page, text: string) {
  // The layers filter is the second input[placeholder="Filter…"] in the nav.
  const filter = page.locator('input[placeholder="Filter…"]').nth(1);
  await filter.fill(text);
}

/** Clicks the Move up IconButton on the row directly. */
export async function moveUp(row: Locator) {
  await row.getByTestId("move-up").click();
}

/** Clicks the Move down IconButton on the row directly. */
export async function moveDown(row: Locator) {
  await row.getByTestId("move-down").click();
}

/** Toggles the layer checkbox — clicks the checkbox input inside the layer row. */
export async function toggleLayerCheckbox(row: Locator) {
  await row.locator('input[type="checkbox"]').click();
}

/** Finds the Recently deleted section header. */
export function recentlyDeletedHeader(page: Page): Locator {
  return page.locator("text=Recently deleted").locator("..");
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
