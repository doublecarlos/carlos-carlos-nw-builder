// End-to-end coverage for ItemPicker.vue's bonus-aware preview: a candidate row
// shows not just its own stats but the stats a bonus it carries would add, resolved as if it
// were actually picked -- so the dropdown reflects what the summary panel would show.
import { test, expect } from "@playwright/test";
import { openBuilder, slotRow, pickerInput } from "./support/app";

// Same item slot-list.spec.ts and stat-panel.spec.ts already rely on: unique across the item
// table, allowed for every class picked by default, and carries its own bonus (gated only on
// the "combat" toggle, which defaults on) granting Combat Advantage -- so the bonus is active
// the moment it's hypothetically equipped, with nothing else needed.
const HEAD_ITEM_WITH_BONUS = "M29 Enchanted Depthweave Cap";
// Same gear_head list, but carries no `bonuses` at all -- the negative control.
const HEAD_ITEM_WITHOUT_BONUS = "M32.5 Cindersilk Hood (AP on mobs)";

test.describe("item picker bonus preview", () => {
  test("a candidate that would activate a bonus shows the stats it would add", async ({
    page,
  }) => {
    await openBuilder(page);
    const row = slotRow(page, "gear.head");
    await pickerInput(row).click();

    const option = row
      .getByTestId("picker-menu")
      .getByTestId("picker-option")
      .filter({ hasText: HEAD_ITEM_WITH_BONUS });
    // Combat Advantage (ca_p) is granted by this item's own bonus, not one of its flat item
    // stats -- so this line can only come from the new bonus-aware preview.
    await expect(
      option.getByTestId("picker-option-bonus-preview"),
    ).toContainText("CA +");
  });

  test("a candidate with no bonuses at all shows no bonus preview line", async ({
    page,
  }) => {
    await openBuilder(page);
    const row = slotRow(page, "gear.head");
    await pickerInput(row).click();

    const option = row
      .getByTestId("picker-menu")
      .getByTestId("picker-option")
      .filter({ hasText: HEAD_ITEM_WITHOUT_BONUS });
    await expect(option.getByTestId("picker-option-bonus-preview")).toHaveCount(
      0,
    );
  });

  test("picking the previewed item makes the same bonus active in the real summary", async ({
    page,
  }) => {
    await openBuilder(page);
    const row = slotRow(page, "gear.head");

    await pickerInput(row).click();
    await row.getByText(HEAD_ITEM_WITH_BONUS, { exact: true }).click();

    // The row's own stat summary (BuildEditor.vue's `statSummary`) now credits the same
    // bonus this item's picker row previewed before it was picked.
    await expect(row).toContainText("CA");
  });
});
