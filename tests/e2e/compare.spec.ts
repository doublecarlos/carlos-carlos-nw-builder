// End-to-end coverage for the quick-compare picker (App.vue's top bar) and the per-section
// "copy from another build" popover (SectionCopyMenu.vue) -- both need a second build in the
// picture, which slot-list.spec.ts deliberately stays away from.
import { test, expect } from '@playwright/test';
import { openBuilder, chooseItem, chooseCombo, headerRow, slotRow, pickerInput } from './support/app';

const HEAD_ITEM = 'M29 Enchanted Depthweave Cap (CA)';

test('highlighting a diff and applying it copies the compare build\'s choice', async ({ page }) => {
  await openBuilder(page);
  await chooseItem(page, 'gear.head', HEAD_ITEM);

  await page.getByRole('button', { name: '+ New build' }).click();
  await chooseCombo(page.locator('.compare-select'), 'New build');
  await page.getByRole('checkbox', { name: 'Highlight changes' }).check();

  const row = slotRow(page, 'gear.head');
  await expect(row).toHaveClass(/is-diff/);
  await expect(row.locator('.slot-diff-note')).toContainText(HEAD_ITEM);

  await row.getByRole('button', { name: 'apply' }).click();
  await expect(pickerInput(row)).toHaveValue(HEAD_ITEM);
  await expect(row).not.toHaveClass(/is-diff/);
});

test('copying a section from another build fills its slots', async ({ page }) => {
  await openBuilder(page);
  await chooseItem(page, 'gear.head', HEAD_ITEM);

  await page.getByRole('button', { name: '+ New build' }).click();
  const gearHeader = headerRow(page, 'gear');
  const copyBtn = gearHeader.locator('..').locator('.section-copy-btn');
  await copyBtn.click();

  const popover = page.locator('.copy-popover');
  await expect(popover).toBeVisible();
  await chooseCombo(popover.locator('.copy-popover-select'), 'New build');
  await popover.getByRole('button', { name: 'Copy' }).click();

  await expect(pickerInput(slotRow(page, 'gear.head'))).toHaveValue(HEAD_ITEM);
});
