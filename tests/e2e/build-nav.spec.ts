// End-to-end coverage for Library.vue's sidebar: creating/renaming/duplicating/deleting
// collections and builds. slot-list.spec.ts sticks to the single-build experience; this file
// covers the library/collection layer around it.
import { test, expect } from '@playwright/test';
import { openBuilder } from './support/app';
import { buildRow, collectionRow, confirmDangerAction, openRowMenu, renameViaSidebar } from './support/nav';

test('creating a collection adds it to the sidebar and makes it active', async ({ page }) => {
  await openBuilder(page);
  await page.getByRole('button', { name: '+ New collection' }).click();

  const created = collectionRow(page, 'Collection 2');
  await expect(created).toHaveClass(/is-active/);
});

test('creating a build in a collection adds a tab and makes it active', async ({ page }) => {
  await openBuilder(page);
  const collection = collectionRow(page, 'My builds');
  await collection.locator('..').getByRole('button', { name: '+ New build' }).click();

  const created = buildRow(page, 'Build 2');
  await expect(created).toBeVisible();
  await expect(created).toHaveClass(/is-active/);
});

test('renaming a build via the sidebar updates both the tab and the name field', async ({ page }) => {
  await openBuilder(page);
  const row = buildRow(page, 'New build');
  await renameViaSidebar(page, row, 'My Warlock');

  await expect(buildRow(page, 'My Warlock')).toBeVisible();
  await expect(page.locator('.name-input')).toHaveValue('My Warlock');
});

test('duplicating a build via its menu creates a copy and switches to it', async ({ page }) => {
  await openBuilder(page);
  const menu = await openRowMenu(buildRow(page, 'New build'));
  await menu.getByRole('button', { name: 'Duplicate' }).click();

  const copy = buildRow(page, 'New build copy');
  await expect(copy).toBeVisible();
  await expect(copy).toHaveClass(/is-active/);
});

test('deleting a build needs two clicks, and removes it from the sidebar', async ({ page }) => {
  await openBuilder(page);
  const collection = collectionRow(page, 'My builds');
  await collection.locator('..').getByRole('button', { name: '+ New build' }).click();
  await expect(buildRow(page, 'Build 2')).toBeVisible();

  const menu = await openRowMenu(buildRow(page, 'Build 2'));
  await confirmDangerAction(menu, 'Delete');

  await expect(buildRow(page, 'Build 2')).toHaveCount(0);
});

test('a collection\'s last build cannot be deleted', async ({ page }) => {
  await openBuilder(page);
  const menu = await openRowMenu(buildRow(page, 'New build'));
  await expect(menu.getByRole('button', { name: 'Delete' })).toBeDisabled();
});
