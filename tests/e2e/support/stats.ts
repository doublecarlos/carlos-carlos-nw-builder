// Shared helpers for StatPanel.vue's stat source popover (StatSourceCard.vue).
import type { Locator, Page } from '@playwright/test';

/** The circle-alert button that opens a stat's source popover, keyed by its schema stat key
 * (`data-stat-key`, StatPanel.vue's own test hook -- same convention as SlotList.vue's
 * `data-cursor-key`). Scoped to `button` since the open popover carries the same attribute. */
export function statInfoButton(page: Page, key: string): Locator {
  return page.locator(`button[data-stat-key="${key}"]`);
}

/** The one popover for the whole panel -- present only while a stat's card is open. */
export function statCard(page: Page): Locator {
  return page.locator('.statcard');
}

export function statCardClose(page: Page): Locator {
  return statCard(page).locator('.statcard-close');
}

/**
 * Every populated section's source list, in the card's own top-to-bottom order (Rating before
 * Percentage for a paired stat -- StatSourceCard.vue always emits the Rating block first,
 * whether or not it happens to be empty). A section with no sources renders `.statcard-empty`
 * instead and contributes no entry here.
 */
export function statCardSourceGroups(page: Page): Locator {
  return statCard(page).locator('.statcard-rows');
}
