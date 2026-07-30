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
  // .first(): the item's own form-bar, not one of its attached bonuses' (each embedded
  // BonusSetForm has its own "form-bar", same testid, further down the page).
  await editor.getByTestId('form-bar').first().getByRole('button', { name: 'Delete', exact: true }).click();

  const row = editor.locator('.editor-row', { hasText: HEAD_ITEM });
  await expect(row.getByTestId('badge').and(page.locator('[data-variant="removed"]'))).toBeVisible();

  await editor.getByRole('button', { name: '✕ Close' }).click();
  await expect(page.getByRole('button', { name: 'Edit data' }).getByTestId('badge')).toHaveText('1');

  await page.getByRole('button', { name: 'Edit data' }).click();
  await editor.locator('.editor-search').fill(HEAD_ITEM);
  await editor.locator('.editor-row', { hasText: HEAD_ITEM }).getByRole('button', { name: 'restore' }).click();
  await expect(row.getByTestId('badge').and(page.locator('[data-variant="removed"]'))).toHaveCount(0);
});

test('a new item\'s bonus card previews its id live from its own name, and a second "Add bonus" never silently no-ops', async ({ page }) => {
  // Regression: BonusGroups.vue used to generate a bonus's id once, up front, seeded from the
  // *item's* name -- so it never followed what you typed into the bonus's own Name field, and a
  // second "+ Add bonus" click (before the first was saved) collided with it and silently
  // attached nothing. BonusGroups.vue now embeds BonusSetForm.vue itself (the same editor the
  // standalone "Bonus sets" section uses), so the id previews live off Name until first save,
  // exactly like it already did there.
  await openBuilder(page);
  await page.getByRole('button', { name: 'Edit data' }).click();
  const editor = page.locator('.editor-overlay');

  await editor.getByRole('button', { name: '+ New item' }).click();
  const addBonus = editor.getByRole('button', { name: 'Add bonus' });
  await addBonus.click();

  const cards = editor.getByTestId('bonus-card');
  await expect(cards).toHaveCount(1);
  const idPreview = cards.first().getByTitle('Assigned when first saved');
  await expect(idPreview).toHaveText('(assigned on save)');

  const nameInput = cards.first().getByRole('textbox').first();
  await nameInput.fill('Fire Resistance');
  await expect(idPreview).toHaveText('fire-resistance');
  await nameInput.fill('Cold Resistance');
  await expect(idPreview).toHaveText('cold-resistance');

  // Save it, then add a second bonus with a colliding name -- disambiguates against the
  // now-saved sibling, and the first click never silently swallowed the second card.
  await cards.first().getByRole('button', { name: 'Save bonus set' }).click();
  await addBonus.click();
  await expect(cards).toHaveCount(2);
  await cards.nth(1).getByRole('textbox').first().fill('Cold Resistance');
  await expect(cards.nth(1).getByTitle('Assigned when first saved')).toHaveText('cold-resistance-2');
});
