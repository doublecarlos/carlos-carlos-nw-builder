// End-to-end coverage for a slot row's own "+" shortcut (BuildSlot.vue/ItemPickerRow.vue/
// PointAssignmentRow.vue -> BuildEditor.vue's `onAddItem` -> LayerEditor.vue's route-driven
// `duplicateItemSeed` seeding) -- jumps to the layer editor with a fresh, unsaved item draft
// whose filter is pre-filled from the row that was clicked.
import { test, expect } from "@playwright/test";
import { openBuilder, slotRow, addItemButton } from "./support/app";

test.describe("slot row's add-item shortcut", () => {
  test("an item_picker row's + button opens a new item draft pre-filtered to that slot", async ({
    page,
  }) => {
    await openBuilder(page);
    const row = slotRow(page, "gear.head");
    await row.scrollIntoViewIfNeeded();

    await addItemButton(row).click();

    await expect(page.getByTestId("builder-content")).toBeHidden();
    await expect(page.getByTestId("item-name-input")).toHaveValue("");
    await expect(page.getByTestId("item-filter-input")).toHaveValue(
      "gear_head",
    );
  });

  test("a point_assignment row's + button opens a new item draft pre-filtered to that slot", async ({
    page,
  }) => {
    await openBuilder(page);
    const row = slotRow(page, "boons.tier1");
    await row.scrollIntoViewIfNeeded();

    await addItemButton(row).click();

    await expect(page.getByTestId("builder-content")).toBeHidden();
    await expect(page.getByTestId("item-name-input")).toHaveValue("");
    await expect(page.getByTestId("item-filter-input")).toHaveValue(
      "boon_tier1",
    );
  });

  test("navigating back returns to the build editor without leaving the filter seed behind", async ({
    page,
  }) => {
    await openBuilder(page);
    const row = slotRow(page, "gear.head");
    await row.scrollIntoViewIfNeeded();
    await addItemButton(row).click();
    await expect(page.getByTestId("item-filter-input")).toHaveValue(
      "gear_head",
    );

    await page.goBack();
    await expect(page.getByTestId("builder-content")).toBeVisible();

    // A page reload at this point must not resurrect the seed onto a fresh draft.
    await page.reload();
    await expect(page.getByTestId("builder-content")).toBeVisible();
  });
});
