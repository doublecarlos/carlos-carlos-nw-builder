// Shared helpers for driving BuildEditor through the real app shell. Kept to what more than one
// spec needs -- selectors that lean on BuildEditor's own `data-cursor-key` attributes, since those
// are the same hooks the keyboard cursor itself relies on, and a stable choose-item flow.
import { expect, type Locator, type Page } from "@playwright/test";

/** Loads the app into a fresh browser context and creates a build so the builder is
 * visible. With storage on IndexedDB, a fresh context has no data, so the empty state
 * shows first — clicking "+ New build" gets us into the builder. */
export async function openBuilder(page: Page) {
  await page.goto("/");
  // Wait for hydration to finish, then create a build if we see the empty state.
  const newBuildBtn = page.getByTestId("empty-new-build");
  if (await newBuildBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
    await newBuildBtn.click();
  }
  await expect(headerRow(page, "gear")).toBeVisible({ timeout: 5000 });
}

export function headerRow(page: Page, sectionId: string): Locator {
  return page.locator(`[data-cursor-key="header:${sectionId}"]`);
}

/** Clicks a section's header to expand it, unless it's expanded already (a prior toggle in the
 *  same test, or a build switch, can leave collapse state ambiguous from the test's point of
 *  view) -- collapsed sections show "▸", expanded ones "▾". */
export async function ensureSectionExpanded(page: Page, sectionId: string) {
  const arrow = await headerRow(page, sectionId)
    .locator("span:first-child")
    .textContent();
  if (arrow === "▸") await headerRow(page, sectionId).click();
}

export function slotRow(page: Page, slotId: string): Locator {
  return page.locator(`[data-cursor-key="slot:${slotId}"]`);
}

export function pickerInput(row: Locator): Locator {
  return row.getByTestId("picker-input");
}

/** A point_assignment row's stepper input for one item id. */
export function assignmentInput(row: Locator, itemId: string): Locator {
  return row.getByTestId(`assignment-input-${itemId}`);
}

/** A point_assignment row's item-name label -- the hover-card trigger for that item. */
export function assignmentLabel(row: Locator, itemId: string): Locator {
  return row.getByTestId(`assignment-label-${itemId}`);
}

/** A row's own "new item" shortcut -- present on item_picker and point_assignment rows only
 *  (see BuildSlot.vue/ItemPickerRow.vue/PointAssignmentRow.vue). */
export function addItemButton(row: Locator): Locator {
  return row.getByTestId("add-item-for-slot");
}

/** Clicks the -/+ button next to a point_assignment row's stepper input. Ctrl/Cmd+click (via
 *  `modifiers`) jumps straight to that direction's bound instead of stepping by one. */
export async function stepAssignment(
  row: Locator,
  itemId: string,
  dir: "increase" | "decrease",
  options?: { modifiers?: ("Control" | "Meta")[] },
) {
  const wrapper = assignmentInput(row, itemId).locator("..");
  await wrapper
    .getByTitle(dir === "increase" ? "Increase" : "Decrease")
    .click({ modifiers: options?.modifiers });
}

/** An item_picker row's stepper input for one BonusOccurrenceConfig attachment, keyed by
 *  bonus id. */
export function occurrenceInput(row: Locator, bonusId: string): Locator {
  return row.getByTestId(`occurrence-input-${bonusId}`);
}

/** An item_picker row's checkbox for a 0-1 BonusOccurrenceConfig attachment, keyed by
 *  bonus id. */
export function occurrenceCheckbox(row: Locator, bonusId: string): Locator {
  return row.getByTestId(`occurrence-toggle-${bonusId}`);
}

/** Clicks the -/+ button next to an item_picker row's occurrence stepper. Ctrl/Cmd+click (via
 *  `modifiers`) jumps straight to that direction's bound instead of stepping by one. */
export async function stepOccurrence(
  row: Locator,
  bonusId: string,
  dir: "increase" | "decrease",
  options?: { modifiers?: ("Control" | "Meta")[] },
) {
  const wrapper = occurrenceInput(row, bonusId).locator("..");
  await wrapper
    .getByTitle(dir === "increase" ? "Increase" : "Decrease")
    .click({ modifiers: options?.modifiers });
}

/** The row currently holding real focus -- a header button, a slot row's invisible cursor
 * anchor, or a slot row's picker input all make their row match `:focus-within`, which is the
 * native-focus replacement for the old virtual-cursor `.is-cursor` class. */
export function cursorRow(page: Page): Locator {
  return page.locator("[data-cursor-key]:focus-within");
}

export async function cursorKey(page: Page): Promise<string | null> {
  return cursorRow(page).getAttribute("data-cursor-key");
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

/** Picks an option from a ComboBox.vue instance (the compare picker, a section's "copy from"
 * picker, …) -- same click-to-open/click-the-row interaction as `chooseItem` above, just over
 * a fixed option list instead of the item catalogue. */
export async function chooseCombo(combo: Locator, label: string) {
  await combo.getByTestId("picker-input").click();
  await combo.getByText(label, { exact: true }).click();
}

/** The build slot text filter input, above the section list. */
export function slotFilterInput(page: Page): Locator {
  return page.getByTestId("slot-filter-text");
}

/** The build slot stat filter's ComboBox, above the section list. */
export function slotFilterStatCombo(page: Page): Locator {
  return page.getByTestId("slot-filter-stat");
}

/** The button that resets both slot filters at once. */
export function slotFilterClearButton(page: Page): Locator {
  return page.getByTestId("slot-filter-clear");
}

/** The undo button in the app header. */
export function undoButton(page: Page): Locator {
  return page.getByTestId("header-undo");
}

/** The redo button in the app header. */
export function redoButton(page: Page): Locator {
  return page.getByTestId("header-redo");
}

/** The draft indicator in the editor header. */
export function draftIndicator(page: Page): Locator {
  return page.getByTestId("draft-indicator");
}
