// End-to-end coverage for BuildBar.vue: renaming, save/revert against the dirty state, and
// undo/redo (including the tooltip label naming the step it would reverse).
import { test, expect } from '@playwright/test';
import { openBuilder, chooseItem, slotRow, pickerInput } from './support/app';

const HEAD_ITEM = 'M29 Enchanted Depthweave Cap (CA)';

test('renaming via the name field updates the sidebar tab', async ({ page }) => {
  await openBuilder(page);
  await page.locator('.name-input').fill('My Warlock');
  await page.locator('.name-input').blur();

  await expect(page.locator('.nav-row--build')).toHaveText(/My Warlock/);
});

test('Save is disabled until dirty, and clears the unsaved dot', async ({ page }) => {
  await openBuilder(page);
  const actions = page.locator('.buildbar-actions');
  const save = actions.getByRole('button', { name: 'Save', exact: true });
  await expect(save).toBeDisabled();

  await chooseItem(page, 'gear.head', HEAD_ITEM);
  await expect(save).toBeEnabled();
  await expect(page.locator('.nav-row--build').getByTestId('unsaved-dot')).toBeVisible();

  await save.click();
  await expect(save).toBeDisabled();
  await expect(page.locator('.nav-row--build .unsaved-dot')).toHaveCount(0);
});

test('Revert discards an unsaved choice after a two-step confirm', async ({ page }) => {
  await openBuilder(page);
  await chooseItem(page, 'gear.head', HEAD_ITEM);

  const revert = page.locator('.buildbar-actions').getByRole('button', { name: 'Revert', exact: true });
  await revert.click();
  await expect(page.getByRole('button', { name: 'Really revert?' })).toBeVisible();
  await page.getByRole('button', { name: 'Really revert?' }).click();

  await expect(pickerInput(slotRow(page, 'gear.head'))).toHaveValue('');
});

test('Undo/redo carry a label naming the step, and walk the history back and forth', async ({ page }) => {
  await openBuilder(page);
  const undo = page.getByRole('button', { name: /Undo/ });
  const redo = page.getByRole('button', { name: /Redo/ });
  await expect(undo).toBeDisabled();

  await chooseItem(page, 'gear.head', HEAD_ITEM);
  await expect(undo).toContainText(HEAD_ITEM);
  await expect(undo).toBeEnabled();

  await undo.click();
  await expect(pickerInput(slotRow(page, 'gear.head'))).toHaveValue('');
  await expect(undo).toBeDisabled();
  await expect(redo).toContainText(HEAD_ITEM);

  await redo.click();
  await expect(pickerInput(slotRow(page, 'gear.head'))).toHaveValue(HEAD_ITEM);
  await expect(redo).toBeDisabled();
});
