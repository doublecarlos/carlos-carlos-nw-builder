// Shared helpers for driving BuildEditor through the real app shell. Kept to what more than one
// spec needs -- selectors that lean on BuildEditor's own `data-cursor-key` attributes, since those
// are the same hooks the keyboard cursor itself relies on, and a stable choose-item flow.
import { expect, type Locator, type Page } from "@playwright/test";
import { shippedItemName } from "./shippedData";

/** Loads the app into a fresh browser context and gets into the builder. With storage on
 * IndexedDB, a fresh context has no data, so the landing screen shows first — clicking
 * "New build" steps past it. */
export async function openBuilder(page: Page) {
  await page.goto("/");
  // Wait for hydration to settle on one of the two things it can show, then step past the
  // landing screen if that is the one. Waiting for either -- rather than probing for the
  // button on a timeout -- is what keeps a slow hydration under parallel load from quietly
  // skipping the click and stranding the test on the landing.
  const newBuildBtn = page.getByTestId("landing-new-build");
  await expect(newBuildBtn.or(headerRow(page, "gear")).first()).toBeVisible({
    timeout: 15000,
  });
  if (await newBuildBtn.isVisible()) {
    await newBuildBtn.click();
    // Park the pointer out of the way: the button sits mid-viewport, and a later `hover()`
    // that lands on the same point fires no mousemove, so hover cards never open.
    await page.mouse.move(0, 0);
  }
  await expect(headerRow(page, "gear")).toBeVisible({ timeout: 10000 });
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

/**
 * Parks the keyboard cursor on a row without focusing the control it holds -- the starting
 * point for any arrow-key assertion, since real focus *is* the cursor and arrows need
 * somewhere to start from.
 *
 * Clicks the row's right-hand gutter, past whatever control sits on its left. The row's label
 * used to serve as this target, back when its `for` named an id no control claimed; now that
 * the association works, clicking a label focuses (and opens) that row's control, which is the
 * opposite of parking.
 */
export async function parkCursorOnRow(page: Page, slotId: string) {
  const row = slotRow(page, slotId);
  const box = await row.boundingBox();
  if (!box) throw new Error(`slot row "${slotId}" has no layout box`);
  await row.click({ position: { x: box.width - 8, y: box.height / 2 } });
  await expect(row).toHaveAttribute("data-cursor-key", `slot:${slotId}`);
}

/**
 * Moves focus off whatever field or row holds it, the precondition for any shortcut guarded by
 * `isFormControl`. Clicks the header's top-left corner rather than its centre: the bar is a row
 * of controls, and its middle is whichever one happens to land there at the current width.
 */
export async function blurToHeader(page: Page) {
  await page.getByTestId("app-header").click({ position: { x: 4, y: 4 } });
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
    .getByLabel(dir === "increase" ? "Increase" : "Decrease")
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
    .getByLabel(dir === "increase" ? "Increase" : "Decrease")
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
  // Park the pointer clear of the row. The option just clicked can sit inside the row's own
  // box, and the item card opens on `mouseenter` -- a later `.hover()` on a row the pointer
  // never left would fire nothing.
  await page.mouse.move(0, 0);
}

/**
 * Hovers something that opens the shared item card, with the card's own preconditions met: the
 * target scrolled into view first, since the card closes on any scroll and a hover that has to
 * scroll would close what it just opened, and the pointer parked outside beforehand, since the
 * card opens on `mouseenter` and a pointer a previous click left inside would fire nothing.
 */
export async function hoverForCard(page: Page, target: Locator) {
  await target.scrollIntoViewIfNeeded();
  await page.mouse.move(0, 0);
  await target.hover();
}

/** Picks a class in `options.class`, which is an ordinary item_picker over `class`-tagged
 * items since #273 -- the visible label is the class *item's* name, so it is read from the
 * shipped table rather than hardcoded. `classId` is the bare class ("warlock"). */
export async function chooseClass(page: Page, classId: string) {
  await chooseItem(page, "options.class", shippedItemName(`class-${classId}`));
}

/** The class item's own display name, for asserting what a picked class row shows. */
export function className(classId: string): string {
  return shippedItemName(`class-${classId}`);
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
