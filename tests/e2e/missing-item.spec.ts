// End-to-end coverage for the missing-item marker: define an item in a layer, equip it in a
// build, disable the layer, and see the slot show a "not in your catalog" marker.
// Re-enabling the layer restores the slot.
import { test, expect } from "@playwright/test";
import {
  openBuilder,
  chooseItem,
  slotRow,
  pickerInput,
  setItemFilter,
} from "./support/app";
import { addLayer, layerRow, toggleLayerCheckbox } from "./support/nav";

const UNIQUE_ITEM = "ZZZ Test Custom Layer Item";

test("disable layer → missing marker → re-enable restores the item", async ({
  page,
}) => {
  await openBuilder(page);
  await addLayer(page);
  const layer = layerRow(page, "Layer 1");

  // Create a brand-new item in the layer with a unique name.
  await layer.locator(".nav-name").click();
  await page.getByTestId("new-item").click();
  await page.getByTestId("item-name-input").fill(UNIQUE_ITEM);

  // Also set the filter so it appears in the Head slot's picker.
  await setItemFilter(page, "gear_head");

  await page.getByRole("button", { name: "Save item" }).click();

  // Switch back to the build.
  const build = page.getByTestId("library").locator(".nav-row--build").first();
  await build.locator(".nav-name").click();

  // Equip the custom item in the Head slot.
  await chooseItem(page, "gear.head", UNIQUE_ITEM);
  await expect(pickerInput(slotRow(page, "gear.head"))).toHaveValue(
    UNIQUE_ITEM,
  );

  // Disable the layer via the nav checkbox.
  await toggleLayerCheckbox(layer);

  // The slot now flags the missing item as invalid.
  const headSlot = slotRow(page, "gear.head");
  const input = pickerInput(headSlot);
  await expect(input).toHaveAttribute("aria-invalid", "true");

  // Re-enable the layer.
  await toggleLayerCheckbox(layer);

  // The slot is restored: valid again, value back.
  await expect(input).not.toHaveAttribute("aria-invalid");
  await expect(pickerInput(headSlot)).toHaveValue(UNIQUE_ITEM);
});
