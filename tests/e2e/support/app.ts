// Shared helpers for driving SlotList through the real app shell. Kept to what more than one
// spec needs -- selectors that lean on SlotList's own `data-cursor-key` attributes, since those
// are the same hooks the keyboard cursor itself relies on, and a stable choose-item flow.
import { expect, type Locator, type Page } from '@playwright/test';

/** Loads the app into a fresh browser context (no localStorage yet, so App.vue's own defaults
 * kick in: one build, "gear" the only section expanded) and waits for SlotList to be there. */
export async function openBuilder(page: Page) {
  await page.goto('/');
  await expect(headerRow(page, 'gear')).toBeVisible();
}

export function headerRow(page: Page, sectionId: string): Locator {
  return page.locator(`[data-cursor-key="header:${sectionId}"]`);
}

export function slotRow(page: Page, slotId: string): Locator {
  return page.locator(`[data-cursor-key="slot:${slotId}"]`);
}

export function pickerInput(row: Locator): Locator {
  return row.locator('input.picker-input');
}

/** The single row currently carrying the keyboard cursor (`.is-cursor`, shared by header and
 * slot rows) -- reads it back via the same `data-cursor-key` the composable navigates by. */
export function cursorRow(page: Page): Locator {
  return page.locator('.is-cursor');
}

export async function cursorKey(page: Page): Promise<string | null> {
  return cursorRow(page).getAttribute('data-cursor-key');
}

/** Opens a slot's picker, types the item's full (unique) name to filter down to it, and clicks
 * the matching row -- the same path a user takes, not a shortcut around ItemPicker. */
export async function chooseItem(page: Page, slotId: string, itemName: string) {
  const row = slotRow(page, slotId);
  const input = pickerInput(row);
  await input.click();
  await input.fill(itemName);
  await row.getByText(itemName, { exact: true }).click();
}
