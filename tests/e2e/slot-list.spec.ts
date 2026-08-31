// End-to-end coverage for BuildEditor.vue's own interactions -- picking/clearing items, the
// section header controls, and the passive keyboard cursor. Quick-compare, unsaved/revert and
// copy-section are covered separately; this file sticks to the base single-build experience.
import { test, expect, type Page } from "@playwright/test";
import {
  parkCursorOnRow,
  openBuilder,
  headerRow,
  ensureSectionExpanded,
  slotRow,
  pickerInput,
  cursorRow,
  cursorKey,
  chooseItem,
} from "./support/app";

// Unique across the whole item table (grep-checked) and allowed for the default "warlock"
// class, so it always shows up in the Head slot's own filtered picker list.
const HEAD_ITEM = "M29 Enchanted Depthweave Cap";

test.describe("choosing and clearing an item", () => {
  test("choosing an item fills the slot and updates the section's filled count", async ({
    page,
  }) => {
    await openBuilder(page);
    const header = headerRow(page, "gear");
    const [filledBefore, total] = (
      await header.locator(".section-count").innerText()
    ).split("/");
    expect(filledBefore).toBe("0");

    await chooseItem(page, "gear.head", HEAD_ITEM);

    await expect(pickerInput(slotRow(page, "gear.head"))).toHaveValue(
      HEAD_ITEM,
    );
    await expect(header.locator(".section-count")).toHaveText(`1/${total}`);
  });

  test('clearing a slot via the picker\'s "empty" option removes the item', async ({
    page,
  }) => {
    await openBuilder(page);
    await chooseItem(page, "gear.head", HEAD_ITEM);
    const row = slotRow(page, "gear.head");

    await pickerInput(row).click();
    await row.getByText("- empty -", { exact: true }).click();

    await expect(pickerInput(row)).toHaveValue("");
  });

  test("opening a picker scrolls the menu to the current pick without scrolling the page", async ({
    page,
  }) => {
    // Reopening highlights whatever is already selected and scrolls it into view. That scroll
    // has to stay inside the menu: moving the document instead pulls the input out from under
    // the pointer mid-click, which left the picker unopenable for any selection far enough down
    // its list -- HEAD_ITEM is the lowest item level in this slot, so it sits at the bottom.
    await openBuilder(page);
    await chooseItem(page, "gear.head", HEAD_ITEM);
    const row = slotRow(page, "gear.head");

    const scrollBefore = await page.evaluate(() => window.scrollY);
    await pickerInput(row).click();

    await expect(page.getByTestId("picker-menu").first()).toBeVisible();
    expect(await page.evaluate(() => window.scrollY)).toBe(scrollBefore);
  });

  test("clearing a slot via Backspace on the keyboard cursor removes the item", async ({
    page,
  }) => {
    await openBuilder(page);
    await chooseItem(page, "gear.head", HEAD_ITEM);
    const row = slotRow(page, "gear.head");

    // A plain click on the row (not its input) parks the keyboard cursor there without
    // reopening the picker.
    await parkCursorOnRow(page, "gear.head");
    await expect(cursorRow(page)).toHaveAttribute(
      "data-cursor-key",
      "slot:gear.head",
    );

    await page.keyboard.press("Backspace");
    await expect(pickerInput(row)).toHaveValue("");
  });
});

test.describe("row click behaviour", () => {
  test("Ctrl+click on a filled slot opens the layer editor on that item; a plain click does not", async ({
    page,
  }) => {
    await openBuilder(page);
    await chooseItem(page, "gear.head", HEAD_ITEM);
    const row = slotRow(page, "gear.head");

    await parkCursorOnRow(page, "gear.head");
    await expect(cursorRow(page)).toHaveAttribute(
      "data-cursor-key",
      "slot:gear.head",
    );
    // No modifier: the build editor stays visible.
    await expect(page.getByTestId("builder-content")).toBeVisible();

    // Ctrl+click: the layer editor opens with the item form.
    await row.locator(".slot-label").click({ modifiers: ["Control"] });
    await expect(page.getByTestId("builder-content")).toBeHidden();
    await expect(page.locator(".editor-row.is-on .editor-row-name")).toHaveText(
      HEAD_ITEM,
    );
  });

  test("Ctrl+click on an empty slot opens a new item draft pre-filled with that slot's filter", async ({
    page,
  }) => {
    await openBuilder(page);
    const row = slotRow(page, "gear.head");

    await row.locator(".slot-label").click({ modifiers: ["Control"] });

    await expect(page.getByTestId("builder-content")).toBeHidden();
    await expect(page.getByTestId("item-name-input")).toHaveValue("");
    await expect(page.getByTestId("item-filter-input")).toHaveValue(
      "gear_head",
    );
  });

  test("Ctrl+click on an empty tag-selected slot pre-fills the draft's tags as well", async ({
    page,
  }) => {
    await openBuilder(page);
    await ensureSectionExpanded(page, "companions");
    const row = slotRow(page, "companions.offense");
    await row.scrollIntoViewIfNeeded();

    await row.locator(".slot-label").click({ modifiers: ["Control"] });

    await expect(page.getByTestId("builder-content")).toBeHidden();
    // The tags are what makes an item a candidate in a tag-selected slot; the filter is
    // borrowed from the candidates already there, since the form cannot save without one.
    await expect(page.getByTestId("item-tags-input")).toContainText(
      "companion_power:offense",
    );
    await expect(page.getByTestId("item-filter-input")).toHaveValue(
      "companion_power",
    );
  });

  test("the pre-filled draft is one-shot: coming back to the layer opens a blank one", async ({
    page,
  }) => {
    await openBuilder(page);
    await slotRow(page, "gear.head")
      .locator(".slot-label")
      .click({ modifiers: ["Control"] });
    await expect(page.getByTestId("item-filter-input")).toHaveValue(
      "gear_head",
    );

    // Back to the build, then into the same layer again -- the seed belonged to that one jump,
    // so the second visit gets an ordinary blank draft.
    await page.locator(".nav-row--build .nav-name").first().click();
    await expect(page.getByTestId("builder-content")).toBeVisible();
    await page.locator(".nav-row--layer .nav-name").first().click();

    await expect(page.getByTestId("builder-content")).toBeHidden();
    await expect(page.getByTestId("item-filter-input")).toHaveValue("");
  });
});

test.describe("section collapse/expand", () => {
  test("clicking a section header toggles its body", async ({ page }) => {
    await openBuilder(page);
    await expect(slotRow(page, "gear.head")).toBeVisible();

    await headerRow(page, "gear").click();
    await expect(slotRow(page, "gear.head")).toBeHidden();

    await headerRow(page, "gear").click();
    await expect(slotRow(page, "gear.head")).toBeVisible();
  });

  test('"expand all" / "collapse all" open and close every section', async ({
    page,
  }) => {
    await openBuilder(page);
    // All sections start open by default -- see `data/slots.json`'s `defaultOpen` per section.
    await expect(slotRow(page, "gear.head")).toBeVisible();
    await expect(slotRow(page, "reinforcements.armorKit1")).toBeVisible();
    await expect(slotRow(page, "options.class")).toBeVisible();

    await page.getByRole("button", { name: "collapse all" }).click();
    await expect(slotRow(page, "gear.head")).toBeHidden();
    await expect(slotRow(page, "options.class")).toBeHidden();

    await page.getByRole("button", { name: "expand all" }).click();
    await expect(slotRow(page, "gear.head")).toBeVisible();
    await expect(slotRow(page, "reinforcements.armorKit1")).toBeVisible();
    await expect(slotRow(page, "options.class")).toBeVisible();
  });

  test("the Options header's badge only counts its item_picker slots (Class, Paragon)", async ({
    page,
  }) => {
    await openBuilder(page);
    // Two, since Class is an item_picker; the build_parameter rows still don't count, and
    // Scenario flags is an item_picker_list with no rows yet, which is what this asserts.
    await expect(
      headerRow(page, "options").locator(".section-count"),
    ).toHaveText("0/2");
    await expect(headerRow(page, "gear").locator(".section-count")).toHaveText(
      /^\d+\/\d+$/,
    );
  });

  test("open/closed state survives a reload", async ({ page }) => {
    await openBuilder(page);
    // All sections start open by default.
    await expect(slotRow(page, "reinforcements.armorKit1")).toBeVisible();

    await headerRow(page, "reinforcements").click();
    await expect(slotRow(page, "reinforcements.armorKit1")).toBeHidden();

    await page.reload();
    await expect(headerRow(page, "gear")).toBeVisible();
    await expect(slotRow(page, "reinforcements.armorKit1")).toBeHidden();
  });

  test("open/closed state is a UI preference, not saved with the build", async ({
    page,
  }) => {
    await openBuilder(page);
    // Collapse reinforcements (it starts open by default).
    await headerRow(page, "reinforcements").click();
    await expect(slotRow(page, "reinforcements.armorKit1")).toBeHidden();

    // A brand-new build sees the same section states -- proving they live outside any one
    // build's own document rather than resetting to the shared defaults.
    await page.getByTestId("nav-add-build").click();
    await expect(slotRow(page, "reinforcements.armorKit1")).toBeHidden();

    // Collapsing is not a build edit, so it never lands on the undo stack.
    await expect(page.getByRole("button", { name: "Undo" })).toBeDisabled();
  });
});

/**
 * Parks the native-focus cursor on the Options header. There's no virtual cursor to fall
 * back to, so arrows need focus to start from somewhere: a plain click on the first Options
 * slot row's label focuses that row's cursor anchor, then ArrowUp moves focus up to the
 * header button itself.
 */
async function parkOnOptionsHeader(page: Page) {
  await parkCursorOnRow(page, "options.class");
  await page.keyboard.press("ArrowUp");
  await expect(cursorRow(page)).toHaveAttribute(
    "data-cursor-key",
    "header:options",
  );
}

test.describe("keyboard cursor", () => {
  test("ArrowDown/Up walk headers and only expanded sections' slot rows", async ({
    page,
  }) => {
    await openBuilder(page);
    await parkOnOptionsHeader(page);

    // Options is expanded, so the next row is its first slot.
    await page.keyboard.press("ArrowDown");
    await expect(cursorRow(page)).toHaveAttribute(
      "data-cursor-key",
      "slot:options.class",
    );

    // Walk through all Options slots -- the one after the last is the Race and Leveling header.
    const optionsSlotCount = await page
      .locator('[data-cursor-key^="slot:options."]')
      .count();
    for (let i = 0; i < optionsSlotCount; i += 1)
      await page.keyboard.press("ArrowDown");
    await expect(cursorRow(page)).toHaveAttribute(
      "data-cursor-key",
      "header:raceLeveling",
    );

    // Walk through all Race and Leveling slots -- the one after the last is the Gear header.
    const raceLevelingSlotCount = await page
      .locator('[data-cursor-key^="slot:raceLeveling."]')
      .count();
    for (let i = 0; i < raceLevelingSlotCount + 1; i += 1)
      await page.keyboard.press("ArrowDown");
    await expect(cursorRow(page)).toHaveAttribute(
      "data-cursor-key",
      "header:gear",
    );

    // Walk through all Gear slots.
    const gearSlotCount = await page
      .locator('[data-cursor-key^="slot:gear."]')
      .count();
    for (let i = 0; i < gearSlotCount; i += 1)
      await page.keyboard.press("ArrowDown");
    const lastGearKey = await cursorKey(page);
    expect(lastGearKey).toMatch(/^slot:gear\./);

    // ArrowUp reverses back to the previous gear slot.
    await page.keyboard.press("ArrowUp");
    await page.keyboard.press("ArrowDown");
    await expect(cursorRow(page)).toHaveAttribute(
      "data-cursor-key",
      lastGearKey!,
    );
  });

  test("Enter on a header row toggles that section", async ({ page }) => {
    await openBuilder(page);
    await parkOnOptionsHeader(page);
    // Walk through all expanded Options slots, then one more to reach the Race and Leveling
    // header, then through its slots and one more to reach the Gear header.
    const optionsSlotCount = await page
      .locator('[data-cursor-key^="slot:options."]')
      .count();
    for (let i = 0; i < optionsSlotCount + 1; i += 1)
      await page.keyboard.press("ArrowDown");
    const raceLevelingSlotCount = await page
      .locator('[data-cursor-key^="slot:raceLeveling."]')
      .count();
    for (let i = 0; i < raceLevelingSlotCount + 1; i += 1)
      await page.keyboard.press("ArrowDown");
    await expect(cursorRow(page)).toHaveAttribute(
      "data-cursor-key",
      "header:gear",
    );
    await expect(slotRow(page, "gear.head")).toBeVisible();

    // Enter on the focused header button is the button's native click: it toggles.
    await page.keyboard.press("Enter");
    await expect(slotRow(page, "gear.head")).toBeHidden();

    await page.keyboard.press("Enter");
    await expect(slotRow(page, "gear.head")).toBeVisible();
  });

  test("Enter on a slot row focuses its picker", async ({ page }) => {
    await openBuilder(page);
    await parkOnOptionsHeader(page);
    // Walk through all expanded Options slots, then one more for the Race and Leveling header,
    // then through its slots and one more for the Gear header, then its first slot.
    const optionsSlotCount = await page
      .locator('[data-cursor-key^="slot:options."]')
      .count();
    for (let i = 0; i < optionsSlotCount + 1; i += 1)
      await page.keyboard.press("ArrowDown");
    const raceLevelingSlotCount = await page
      .locator('[data-cursor-key^="slot:raceLeveling."]')
      .count();
    for (let i = 0; i < raceLevelingSlotCount + 1; i += 1)
      await page.keyboard.press("ArrowDown");
    await expect(cursorRow(page)).toHaveAttribute(
      "data-cursor-key",
      "header:gear",
    );
    await page.keyboard.press("ArrowDown"); // -> slot:gear.head
    await expect(cursorRow(page)).toHaveAttribute(
      "data-cursor-key",
      "slot:gear.head",
    );

    await page.keyboard.press("Enter");
    await expect(pickerInput(slotRow(page, "gear.head"))).toBeFocused();
  });

  test("typing a character while a slot has the cursor opens and seeds its picker", async ({
    page,
  }) => {
    await openBuilder(page);
    await parkOnOptionsHeader(page);
    // Walk through all expanded Options slots to reach the Race and Leveling header, then
    // through its slots to reach the Gear header, then past it to its first slot.
    const optionsSlotCount = await page
      .locator('[data-cursor-key^="slot:options."]')
      .count();
    for (let i = 0; i < optionsSlotCount; i += 1)
      await page.keyboard.press("ArrowDown");
    await page.keyboard.press("ArrowDown"); // -> header:raceLeveling
    const raceLevelingSlotCount = await page
      .locator('[data-cursor-key^="slot:raceLeveling."]')
      .count();
    for (let i = 0; i < raceLevelingSlotCount; i += 1)
      await page.keyboard.press("ArrowDown");
    await page.keyboard.press("ArrowDown"); // -> header:gear
    await page.keyboard.press("ArrowDown"); // -> slot:gear.head

    await page.keyboard.press("d");

    const row = slotRow(page, "gear.head");
    await expect(pickerInput(row)).toBeFocused();
    await expect(pickerInput(row)).toHaveValue("d");
    await expect(row.getByTestId("picker-menu")).toBeVisible();
  });

  test("arrow keys are not treated as row navigation while the picker input is focused", async ({
    page,
  }) => {
    await openBuilder(page);
    await parkOnOptionsHeader(page);
    // Walk through all expanded Options slots to reach the Race and Leveling header, then
    // through its slots to reach the Gear header, then past it to its first slot.
    const optionsSlotCount = await page
      .locator('[data-cursor-key^="slot:options."]')
      .count();
    for (let i = 0; i < optionsSlotCount; i += 1)
      await page.keyboard.press("ArrowDown");
    await page.keyboard.press("ArrowDown"); // -> header:raceLeveling
    const raceLevelingSlotCount = await page
      .locator('[data-cursor-key^="slot:raceLeveling."]')
      .count();
    for (let i = 0; i < raceLevelingSlotCount; i += 1)
      await page.keyboard.press("ArrowDown");
    await page.keyboard.press("ArrowDown"); // -> header:gear
    await page.keyboard.press("ArrowDown"); // -> slot:gear.head
    await expect(cursorRow(page)).toHaveAttribute(
      "data-cursor-key",
      "slot:gear.head",
    );

    const row = slotRow(page, "gear.head");
    await pickerInput(row).click();
    await expect(row.getByTestId("picker-menu")).toBeVisible();

    // The picker input now has focus and its own key handling owns the arrows -- keydowns
    // inside the input never reach the row's cursor anchor (a sibling, not an ancestor).
    await page.keyboard.press("ArrowDown");
    await expect(cursorRow(page)).toHaveAttribute(
      "data-cursor-key",
      "slot:gear.head",
    );
    await expect(row.getByTestId("picker-menu")).toBeVisible();
  });

  test("Escape from an open picker keeps the row cursor", async ({ page }) => {
    await openBuilder(page);
    // Park the cursor directly on a row (click its label, not the input).
    await parkCursorOnRow(page, "gear.head");
    await expect(cursorRow(page)).toHaveAttribute(
      "data-cursor-key",
      "slot:gear.head",
    );

    // Enter opens the picker; Escape closes it and blurs to the row's cursor anchor instead
    // of <body>, so the row stays highlighted and arrow keys stay live.
    await page.keyboard.press("Enter");
    const row = slotRow(page, "gear.head");
    await expect(pickerInput(row)).toBeFocused();
    await expect(row.getByTestId("picker-menu")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(cursorRow(page)).toHaveAttribute(
      "data-cursor-key",
      "slot:gear.head",
    );

    // The cursor is live again: arrows move to a neighbouring row.
    await page.keyboard.press("ArrowDown");
    expect(await cursorKey(page)).not.toBe("slot:gear.head");
  });

  test("choosing with Enter keeps the row cursor", async ({ page }) => {
    await openBuilder(page);
    await parkCursorOnRow(page, "gear.head");
    const row = slotRow(page, "gear.head");

    // Type-ahead seeds the picker, Enter chooses the highlighted option -- the picker then
    // blurs to the row's cursor anchor (same as Escape), not to <body>.
    await page.keyboard.press("d");
    await expect(pickerInput(row)).toBeFocused();
    await expect(row.getByTestId("picker-menu")).toBeVisible();
    await page.keyboard.press("Enter");
    await expect(cursorRow(page)).toHaveAttribute(
      "data-cursor-key",
      "slot:gear.head",
    );

    await page.keyboard.press("ArrowDown");
    expect(await cursorKey(page)).not.toBe("slot:gear.head");
  });
});

test.describe("separator slots", () => {
  test("renders visibly between Boots and Neck but carries no cursor key", async ({
    page,
  }) => {
    await openBuilder(page);
    const separator = page.getByTestId("separator:gear.sepBootsNeck");
    await expect(separator).toBeVisible();
    await expect(separator).not.toHaveAttribute("data-cursor-key");
  });

  test("ArrowDown from Boots skips straight to Neck", async ({ page }) => {
    await openBuilder(page);
    await parkCursorOnRow(page, "gear.boots");
    await expect(cursorRow(page)).toHaveAttribute(
      "data-cursor-key",
      "slot:gear.boots",
    );

    await page.keyboard.press("ArrowDown");
    await expect(cursorRow(page)).toHaveAttribute(
      "data-cursor-key",
      "slot:gear.neck",
    );
  });

  test("the row right above a separator has no bottom border of its own", async ({
    page,
  }) => {
    await openBuilder(page);
    // Boots sits right above the separator: its own border is suppressed so it doesn't
    // double up against the separator's bar. Neck has no separator after it and keeps its own.
    await expect(slotRow(page, "gear.boots")).toHaveCSS(
      "border-bottom-width",
      "0px",
    );
    await expect(slotRow(page, "gear.neck")).toHaveCSS(
      "border-bottom-width",
      "1px",
    );
  });
});

test.describe("text slots", () => {
  test("renders visibly before Mount Combat, muted, with no cursor key", async ({
    page,
  }) => {
    await openBuilder(page);
    const note = page.getByTestId("text:mounts.textCelestial");
    await expect(note).toBeVisible();
    await expect(note).toContainText("Mounts are assumed to");
    await expect(note).not.toHaveAttribute("data-cursor-key");
  });

  test("ArrowDown past the Mounts bolster param skips the note", async ({
    page,
  }) => {
    await openBuilder(page);
    await parkCursorOnRow(page, "mounts.mountCombat");
    await page.keyboard.press("ArrowUp");
    // The bolster param is a real row and takes the cursor; the note between it and Mount
    // Combat does not.
    await expect(cursorRow(page)).toHaveAttribute(
      "data-cursor-key",
      "slot:mounts.bolster",
    );

    await page.keyboard.press("ArrowUp");
    await expect(cursorRow(page)).toHaveAttribute(
      "data-cursor-key",
      "header:mounts",
    );

    await page.keyboard.press("ArrowDown");
    await expect(cursorRow(page)).toHaveAttribute(
      "data-cursor-key",
      "slot:mounts.bolster",
    );
    await page.keyboard.press("ArrowDown");
    await expect(cursorRow(page)).toHaveAttribute(
      "data-cursor-key",
      "slot:mounts.mountCombat",
    );
  });
});

// build_parameter rows (in the Options section) share the same keyboard cursor
// infrastructure as item_picker rows -- Enter-to-focus, type-to-seed, Delete-to-reset --
// just exercised on a different control type.
test.describe("keyboard cursor: build_parameter rows", () => {
  // ArrowDown from the parked Options header: #1 → slot:options.class, #2 → slot:options.paragon
  // (an item_picker), #3 → slot:options.role.
  test("Enter on a build_parameter row focuses its control", async ({
    page,
  }) => {
    await openBuilder(page);
    await parkOnOptionsHeader(page);
    await page.keyboard.press("ArrowDown");
    await expect(cursorRow(page)).toHaveAttribute(
      "data-cursor-key",
      "slot:options.class",
    );

    const row = slotRow(page, "options.class");
    await page.keyboard.press("Enter");
    await expect(row.getByTestId("picker-input")).toBeFocused();
  });

  test("typing a character opens and seeds a list-type control", async ({
    page,
  }) => {
    await openBuilder(page);
    await parkOnOptionsHeader(page);
    // Three rows down: class and paragon are item_picker rows, and
    // this block is about a build_parameter's own control.
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("ArrowDown");
    await expect(cursorRow(page)).toHaveAttribute(
      "data-cursor-key",
      "slot:options.role",
    );

    const row = slotRow(page, "options.role");
    await page.keyboard.press("t");

    await expect(row.getByTestId("picker-input")).toBeFocused();
    await expect(row.getByTestId("picker-input")).toHaveValue("t");
    await expect(row.getByTestId("picker-menu")).toBeVisible();
    // The role list should be filtered to Tank only
    await expect(row.getByText("Tank", { exact: true })).toBeVisible();
  });

  test("Backspace on a build_parameter row resets to its default", async ({
    page,
  }) => {
    await openBuilder(page);
    await parkOnOptionsHeader(page);
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("ArrowDown");
    await expect(cursorRow(page)).toHaveAttribute(
      "data-cursor-key",
      "slot:options.role",
    );

    const row = slotRow(page, "options.role");
    // Change to 'healer'
    await row.getByTestId("picker-input").click();
    await row.getByText("Healer", { exact: true }).click();

    // Verify it changed
    await expect(row.getByTestId("picker-input")).toHaveValue("Healer");

    // Move cursor back to the row and press Backspace
    await parkCursorOnRow(page, "options.role");
    await page.keyboard.press("Backspace");

    // Backspace clears the slot, same as an item row -- the empty option is the default.
    await expect(row.getByTestId("picker-input")).toHaveValue("- none -");
  });

  test("typing a character while the list is focused does not change rows", async ({
    page,
  }) => {
    await openBuilder(page);
    await parkOnOptionsHeader(page);
    await page.keyboard.press("ArrowDown");
    await expect(cursorRow(page)).toHaveAttribute(
      "data-cursor-key",
      "slot:options.class",
    );

    const row = slotRow(page, "options.class");
    // Open the combobox by clicking its input
    await row.getByTestId("picker-input").click();
    await expect(row.getByTestId("picker-menu")).toBeVisible();

    // The input's own key handling owns arrows while it's focused.
    await page.keyboard.press("ArrowDown");
    await expect(cursorRow(page)).toHaveAttribute(
      "data-cursor-key",
      "slot:options.class",
    );
    await expect(row.getByTestId("picker-menu")).toBeVisible();
  });

  test("Delete (same as Backspace) resets to default", async ({ page }) => {
    await openBuilder(page);
    await parkOnOptionsHeader(page);
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("ArrowDown");
    await expect(cursorRow(page)).toHaveAttribute(
      "data-cursor-key",
      "slot:options.role",
    );

    const row = slotRow(page, "options.role");
    // Change to 'tank'
    await row.getByTestId("picker-input").click();
    await row.getByText("Tank", { exact: true }).click();

    await expect(row.getByTestId("picker-input")).toHaveValue("Tank");

    // Move cursor back and press Delete
    await parkCursorOnRow(page, "options.role");
    await page.keyboard.press("Delete");

    // Delete clears the slot, same as an item row -- the empty option is the default.
    await expect(row.getByTestId("picker-input")).toHaveValue("- none -");
  });
});
