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

/** Clicks a control from the open form's bar, through the bar's menu where a phone keeps it. */
export async function formBarControl(page: Page, testid: string) {
  const menu = page.getByTestId("form-bar-menu");
  if (await menu.isVisible()) await menu.click();
  await page.getByTestId(testid).click();
}

/** Ticks the item form's "Show all fields", then closes the bar's menu if it was in one. */
export async function showAllFields(page: Page) {
  await formBarControl(page, "show-all-fields");
  if (await page.getByTestId("form-bar-menu").isVisible())
    await page.keyboard.press("Escape");
}
