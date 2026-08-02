// End-to-end coverage for BuildEditor.vue's own interactions -- picking/clearing items, the
// section header controls, and the passive keyboard cursor. Quick-compare, unsaved/revert and
// copy-section are covered separately; this file sticks to the base single-build experience.
import { test, expect } from "@playwright/test";
import {
  openBuilder,
  headerRow,
  slotRow,
  pickerInput,
  cursorRow,
  cursorKey,
  chooseItem,
} from "./support/app";

// Unique across the whole item table (grep-checked) and allowed for the default "warlock"
// class, so it always shows up in the Head slot's own filtered picker list.
const HEAD_ITEM = "M29 Enchanted Depthweave Cap (CA)";

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
    await row.getByText("— empty —", { exact: true }).click();

    await expect(pickerInput(row)).toHaveValue("");
  });

  test("clearing a slot via Backspace on the keyboard cursor removes the item", async ({
    page,
  }) => {
    await openBuilder(page);
    await chooseItem(page, "gear.head", HEAD_ITEM);
    const row = slotRow(page, "gear.head");

    // A plain click on the row (not its input) parks the keyboard cursor there without
    // reopening the picker.
    await row.locator(".slot-label").click();
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

    await row.locator(".slot-label").click();
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
    // Gear starts open, Reinforcements starts closed, Options starts closed -- see App.vue's
    // `OPEN_BY_DEFAULT` (only "gear" is in it).
    await expect(slotRow(page, "gear.head")).toBeVisible();
    await expect(slotRow(page, "reinforcements.armorKit1")).toBeHidden();
    await expect(slotRow(page, "options.class")).toBeHidden();

    // Open Options by hand -- it's a normal section now (a build_parameter slot per field),
    // so this just proves "expand all"/"collapse all" apply to it the same as any other.
    await headerRow(page, "options").click();
    await expect(slotRow(page, "options.class")).toBeVisible();

    await page.getByRole("button", { name: "collapse all" }).click();
    await expect(slotRow(page, "gear.head")).toBeHidden();
    await expect(slotRow(page, "options.class")).toBeHidden();

    await page.getByRole("button", { name: "expand all" }).click();
    await expect(slotRow(page, "gear.head")).toBeVisible();
    await expect(slotRow(page, "reinforcements.armorKit1")).toBeVisible();
    await expect(slotRow(page, "options.class")).toBeVisible();
  });

  test("the Options header has no filled/total badge, unlike a real section", async ({
    page,
  }) => {
    await openBuilder(page);
    await expect(
      headerRow(page, "options").locator(".section-count"),
    ).toHaveCount(0);
    await expect(headerRow(page, "gear").locator(".section-count")).toHaveText(
      /^\d+\/\d+$/,
    );
  });

  test("open/closed state survives a reload", async ({ page }) => {
    await openBuilder(page);
    await expect(slotRow(page, "reinforcements.armorKit1")).toBeHidden();

    await headerRow(page, "reinforcements").click();
    await expect(slotRow(page, "reinforcements.armorKit1")).toBeVisible();

    await page.reload();
    await expect(headerRow(page, "gear")).toBeVisible();
    await expect(slotRow(page, "reinforcements.armorKit1")).toBeVisible();
  });

  test("open/closed state is a UI preference, not saved with the build", async ({
    page,
  }) => {
    await openBuilder(page);
    await headerRow(page, "reinforcements").click();
    await expect(slotRow(page, "reinforcements.armorKit1")).toBeVisible();

    // A brand-new build sees the same section states -- proving they live outside any one
    // build's own document rather than resetting to the shared defaults.
    await page.getByRole("button", { name: "+" }).first().click();
    await expect(slotRow(page, "reinforcements.armorKit1")).toBeVisible();

    // Collapsing it back is not a build edit, so it never lands on the undo stack.
    await expect(page.getByRole("button", { name: "Undo" })).toBeDisabled();
  });
});

test.describe("keyboard cursor", () => {
  test("ArrowDown/Up walk headers and only expanded sections' slot rows", async ({
    page,
  }) => {
    await openBuilder(page);

    // A fresh cursor's first ArrowDown always lands on rows[0] -- the Options header.
    await page.keyboard.press("ArrowDown");
    await expect(cursorRow(page)).toHaveAttribute(
      "data-cursor-key",
      "header:options",
    );

    // Options is collapsed, so it contributes no rows of its own -- the very next row is
    // the next header, Gear's.
    await page.keyboard.press("ArrowDown");
    await expect(cursorRow(page)).toHaveAttribute(
      "data-cursor-key",
      "header:gear",
    );

    const gearSlotCount = await page
      .locator('[data-cursor-key^="slot:gear."]')
      .count();
    for (let i = 0; i < gearSlotCount; i += 1)
      await page.keyboard.press("ArrowDown");
    const lastGearKey = await cursorKey(page);
    expect(lastGearKey).toMatch(/^slot:gear\./);

    // Reinforcements starts collapsed, so its rows were never in the DOM to walk onto --
    // the next ArrowDown must land straight on its header.
    await page.keyboard.press("ArrowDown");
    await expect(cursorRow(page)).toHaveAttribute(
      "data-cursor-key",
      "header:reinforcements",
    );

    // ArrowUp reverses the same path, straight back onto the last Gear slot.
    await page.keyboard.press("ArrowUp");
    await expect(cursorRow(page)).toHaveAttribute(
      "data-cursor-key",
      lastGearKey!,
    );
  });

  test("Enter on a header row toggles that section", async ({ page }) => {
    await openBuilder(page);
    await page.keyboard.press("ArrowDown"); // -> header:options
    await page.keyboard.press("ArrowDown"); // -> header:gear
    await expect(slotRow(page, "gear.head")).toBeVisible();

    await page.keyboard.press("Enter");
    await expect(slotRow(page, "gear.head")).toBeHidden();

    await page.keyboard.press("Enter");
    await expect(slotRow(page, "gear.head")).toBeVisible();
  });

  test("Enter on a slot row focuses its picker", async ({ page }) => {
    await openBuilder(page);
    await page.keyboard.press("ArrowDown"); // -> header:options
    await page.keyboard.press("ArrowDown"); // -> header:gear
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
    await page.keyboard.press("ArrowDown"); // -> header:options
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
    await page.keyboard.press("ArrowDown"); // -> header:options
    await page.keyboard.press("ArrowDown"); // -> header:gear
    await page.keyboard.press("ArrowDown"); // -> slot:gear.head
    await expect(cursorRow(page)).toHaveAttribute(
      "data-cursor-key",
      "slot:gear.head",
    );

    const row = slotRow(page, "gear.head");
    await pickerInput(row).click();
    await expect(row.getByTestId("picker-menu")).toBeVisible();

    // A real form control now has focus, so BuildEditor's own passive gate must ignore this --
    // it's ItemPicker's own ArrowDown handler that owns the key here.
    await page.keyboard.press("ArrowDown");
    await expect(cursorRow(page)).toHaveAttribute(
      "data-cursor-key",
      "slot:gear.head",
    );
    await expect(row.getByTestId("picker-menu")).toBeVisible();
  });
});

// build_parameter rows (in the Options section) share the same keyboard cursor
// infrastructure as item_picker rows -- Enter-to-focus, type-to-seed, Delete-to-reset --
// just exercised on a different control type.
test.describe("keyboard cursor: build_parameter rows", () => {
  // Navigation after opening Options: header click focuses header:options,
  // ArrowDown#1 → slot:options.class, ArrowDown#2 → slot:options.role, etc.
  test("Enter on a build_parameter row focuses its control", async ({
    page,
  }) => {
    await openBuilder(page);
    // Open the Options section first
    await headerRow(page, "options").click();
    // Arrow down: header:options → slot:options.class
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
    await headerRow(page, "options").click();
    // header:options → slot:options.class
    await page.keyboard.press("ArrowDown");
    await expect(cursorRow(page)).toHaveAttribute(
      "data-cursor-key",
      "slot:options.class",
    );

    const row = slotRow(page, "options.class");
    await page.keyboard.press("p");

    await expect(row.getByTestId("picker-input")).toBeFocused();
    await expect(row.getByTestId("picker-input")).toHaveValue("p");
    await expect(row.getByTestId("picker-menu")).toBeVisible();
    // The class list should be filtered to Paladin only
    await expect(row.getByText("Paladin", { exact: true })).toBeVisible();
  });

  test("Backspace on a build_parameter row resets to its default", async ({
    page,
  }) => {
    await openBuilder(page);
    await headerRow(page, "options").click();
    // header:options → slot:options.class → slot:options.role
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
    await row.locator(".slot-label").click();
    await page.keyboard.press("Backspace");

    // Should be reset to default (dps)
    await expect(row.getByTestId("picker-input")).toHaveValue("DPS");
  });

  test("typing a character while the list is focused does not change rows", async ({
    page,
  }) => {
    await openBuilder(page);
    await headerRow(page, "options").click();
    // header:options → slot:options.class
    await page.keyboard.press("ArrowDown");
    await expect(cursorRow(page)).toHaveAttribute(
      "data-cursor-key",
      "slot:options.class",
    );

    const row = slotRow(page, "options.class");
    // Open the combobox by clicking its input
    await row.getByTestId("picker-input").click();
    await expect(row.getByTestId("picker-menu")).toBeVisible();

    // ArrowDown while the picker is open: the passive gate should ignore this.
    await page.keyboard.press("ArrowDown");
    await expect(cursorRow(page)).toHaveAttribute(
      "data-cursor-key",
      "slot:options.class",
    );
    await expect(row.getByTestId("picker-menu")).toBeVisible();
  });

  test("Delete (same as Backspace) resets to default", async ({ page }) => {
    await openBuilder(page);
    await headerRow(page, "options").click();
    // header:options → slot:options.class → slot:options.role
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
    await row.locator(".slot-label").click();
    await page.keyboard.press("Delete");

    await expect(row.getByTestId("picker-input")).toHaveValue("DPS");
  });
});
