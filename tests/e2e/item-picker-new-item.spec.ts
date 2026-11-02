// The open picker's "New item" action with a mouse: a button under the list rather than one of
// its options, opening the layer editor on a new item seeded for the row.
import { test, expect } from "@playwright/test";
import {
  openBuilder,
  slotRow,
  pickerInput,
  slotFilterStatCombo,
} from "./support/app";

test("New item opens the layer editor on an item seeded for the row", async ({
  page,
}) => {
  await openBuilder(page);
  await pickerInput(slotRow(page, "gear.boots")).click();
  const newItem = page.getByTestId("picker-new-item");
  // Kept out of the listbox, so arrow keys and Enter never land on it.
  await expect(
    page.getByTestId("picker-menu").getByTestId("picker-new-item"),
  ).toHaveCount(0);

  await newItem.click();

  await expect(page.getByTestId("picker-menu")).toHaveCount(0);
  await expect(page.getByTestId("item-name-input")).toHaveValue("");
  await expect(page.getByTestId("item-filter-input")).toHaveValue("gear_boots");
});

test("a picker with nothing to seed offers no New item", async ({ page }) => {
  await openBuilder(page);
  await slotFilterStatCombo(page).getByTestId("picker-input").click();
  await expect(page.getByTestId("picker-menu")).toBeVisible();
  await expect(page.getByTestId("picker-new-item")).toHaveCount(0);
});
