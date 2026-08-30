// End-to-end coverage for ItemPicker.vue's dropdown width: it grows past the input's own
// width so its stat/bonus preview lines have room, while a plain ComboBox.vue select (no
// preview content to make room for) keeps matching its input exactly.
import { test, expect } from "@playwright/test";
import { openBuilder, slotRow, pickerInput } from "./support/app";

test.describe("item picker menu width", () => {
  test("an item picker's dropdown is wider than its input", async ({
    page,
  }) => {
    await openBuilder(page);
    const row = slotRow(page, "gear.head");
    await pickerInput(row).click();

    const inputBox = await pickerInput(row).boundingBox();
    const menuBox = await row.getByTestId("picker-menu").boundingBox();
    expect(inputBox).not.toBeNull();
    expect(menuBox).not.toBeNull();
    expect(menuBox!.width).toBeGreaterThan(inputBox!.width + 50);
  });

  test("a plain ComboBox select's dropdown matches its input width", async ({
    page,
  }) => {
    await openBuilder(page);
    // A build_parameter's own ComboBox, not an ItemPicker -- `options.class` became an item
    // picker, which is the *other* case this file contrasts against.
    const row = slotRow(page, "options.role");
    await pickerInput(row).click();

    const inputBox = await pickerInput(row).boundingBox();
    const menuBox = await row.getByTestId("picker-menu").boundingBox();
    expect(inputBox).not.toBeNull();
    expect(menuBox).not.toBeNull();
    expect(Math.abs(menuBox!.width - inputBox!.width)).toBeLessThan(2);
  });
});
