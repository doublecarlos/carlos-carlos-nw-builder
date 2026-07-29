// End-to-end coverage for opening/closing the data editor overlay and a basic edit round trip
// (delete an item, see it flagged, restore it) -- the overlay itself, and its "changed" count
// feeding back into the builder's own "Edit data" badge.
import { test, expect } from '@playwright/test';
import { openBuilder } from './support/app';

const HEAD_ITEM = 'M29 Enchanted Depthweave Cap (CA)';

test('opening and closing the data editor', async ({ page }) => {
  await openBuilder(page);
  await page.getByRole('button', { name: 'Edit data' }).click();

  const editor = page.locator('.editor-overlay');
  await expect(editor).toBeVisible();
  await expect(editor.getByRole('button', { name: /Items \d+/ })).toBeVisible();
  await expect(editor.getByRole('button', { name: /Bonus sets \d+/ })).toBeVisible();

  await editor.getByRole('button', { name: '✕ Close' }).click();
  await expect(editor).toBeHidden();
  await expect(page).toHaveURL(/^(?!.*view=editor)/);
});

test('deleting an item flags it, feeds the "Edit data" badge, and restore clears it', async ({ page }) => {
  await openBuilder(page);
  await page.getByRole('button', { name: 'Edit data' }).click();
  const editor = page.locator('.editor-overlay');

  await editor.locator('.editor-search').fill(HEAD_ITEM);
  await editor.locator('.editor-row', { hasText: HEAD_ITEM }).click();
  await editor.getByTestId('form-bar').getByRole('button', { name: 'Delete', exact: true }).click();

  const row = editor.locator('.editor-row', { hasText: HEAD_ITEM });
  await expect(row.getByTestId('badge').and(page.locator('[data-variant="removed"]'))).toBeVisible();

  // App.vue's own overlay-count badge isn't converted to Badge.vue yet -- TODO(tailwind-migration).
  await editor.getByRole('button', { name: '✕ Close' }).click();
  await expect(page.getByRole('button', { name: 'Edit data' }).locator('.badge')).toHaveText('1');

  await page.getByRole('button', { name: 'Edit data' }).click();
  await editor.locator('.editor-search').fill(HEAD_ITEM);
  await editor.locator('.editor-row', { hasText: HEAD_ITEM }).getByRole('button', { name: 'restore' }).click();
  await expect(row.getByTestId('badge').and(page.locator('[data-variant="removed"]'))).toHaveCount(0);
});
