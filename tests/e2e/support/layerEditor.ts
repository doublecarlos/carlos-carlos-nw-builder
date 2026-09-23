// Shared helpers for LayerEditor.vue's tab strip and the Slots tab's outline.
import { type Page } from "@playwright/test";

/** Opens the Slots tab, which hosts sections, slots and presets under one outline. */
export async function openSlotsTab(page: Page) {
  await page.getByTestId("tab-slots").click();
}

/** Picks one entry out of the outline's "New" menu. The menu defaults to the section of
 *  whatever the outline currently has open. */
export async function newInOutline(
  page: Page,
  what: "new-section" | "new-slot" | "new-preset",
) {
  await page.getByTestId("new-slot-entry").click();
  await page.getByTestId(what).click();
}
