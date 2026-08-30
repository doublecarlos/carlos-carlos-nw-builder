// End-to-end coverage for `hidePreview`: an item_picker slot authored with it renders bare
// names in its dropdown -- no item level, no conditional-bonus marker, no stat/bonus preview
// lines -- and its menu stays as narrow as its input, since there is nothing to make room for.
// `options.class` is the slot that asks for it: class items carry ability scores and baseline
// bonuses, so without the flag every row would carry a stat block nobody picks a class by.
import { test, expect, type Locator } from "@playwright/test";
import { openBuilder, slotRow, pickerInput, className } from "./support/app";

const pickerOption = (row: Locator, name: string) =>
  row
    .getByTestId("picker-menu")
    .getByTestId("picker-option")
    .filter({ hasText: name });

test.describe("item picker hidePreview", () => {
  test("the class picker's rows show the class name and nothing else", async ({
    page,
  }) => {
    await openBuilder(page);
    const row = slotRow(page, "options.class");
    await pickerInput(row).click();

    // Warlock has ability scores *and* its own bonuses in the shipped table, so it would show
    // a stat line and the "◈" conditional-bonus marker if the flag weren't honoured.
    const option = pickerOption(row, className("warlock"));
    await expect(option).toHaveText(className("warlock"));
    await expect(option.getByTestId("picker-option-bonus-preview")).toHaveCount(
      0,
    );
    await expect(
      option.getByTestId("picker-option-potential-preview"),
    ).toHaveCount(0);
  });

  test("a hidePreview picker's dropdown matches its input width", async ({
    page,
  }) => {
    await openBuilder(page);
    const row = slotRow(page, "options.class");
    await pickerInput(row).click();

    const inputBox = await pickerInput(row).boundingBox();
    const menuBox = await row.getByTestId("picker-menu").boundingBox();
    expect(inputBox).not.toBeNull();
    expect(menuBox).not.toBeNull();
    expect(Math.abs(menuBox!.width - inputBox!.width)).toBeLessThan(2);
  });

  test("a picker without the flag still shows item levels and previews", async ({
    page,
  }) => {
    await openBuilder(page);
    // The contrast that proves the class picker is lean because of `hidePreview`, not because
    // the preview stopped rendering anywhere -- gear rows still carry their item level.
    const row = slotRow(page, "gear.head");
    await pickerInput(row).click();

    await expect(row.getByTestId("picker-menu")).toContainText("iL");
  });

  test("picking a class from the lean dropdown still works", async ({
    page,
  }) => {
    await openBuilder(page);
    const row = slotRow(page, "options.class");
    await pickerInput(row).click();
    await pickerOption(row, className("warlock")).click();

    await expect(pickerInput(row)).toHaveValue(className("warlock"));
  });
});
