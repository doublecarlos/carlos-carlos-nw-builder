// Shared helpers for BuildNav.vue's sidebar -- collection/build rows, their kebab menus, and
// the shared two-step confirm.
import { expect, type Locator, type Page } from '@playwright/test';

export function collectionRow(page: Page, name: string): Locator {
  return page.locator('.nav-row--collection').filter({ hasText: name });
}

export function buildRow(page: Page, name: string): Locator {
  return page.locator('.nav-row--build').filter({ hasText: name });
}

/** Opens a row's kebab menu and returns it (`.navmenu`), scoped so `getByText` only ever
 * matches within this one open menu. */
export async function openRowMenu(row: Locator): Promise<Locator> {
  await row.locator('.nav-kebab').click();
  const menu = row.locator('.navmenu');
  await expect(menu).toBeVisible();
  return menu;
}

/** Clicks a danger action (Delete/Reset) twice -- the row's own two-step confirm turns the
 * label into "Really?" after the first click. */
export async function confirmDangerAction(menu: Locator, label: string) {
  const button = menu.getByRole('button', { name: label });
  await button.click();
  await menu.getByRole('button', { name: 'Really?' }).click();
}

/** Renames via double-click. `input` is looked up from `page`, not `row` -- once rename mode
 * turns the row's button into an `<input>`, the name text moves into the input's *value*
 * (not its rendered text content), so a `row` locator built with `hasText` stops matching the
 * very row it just found. */
export async function renameViaSidebar(page: Page, row: Locator, name: string) {
  await row.locator('.nav-name').dblclick();
  const input = page.locator('.nav-rename');
  await input.fill(name);
  await input.press('Enter');
}
