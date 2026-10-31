// End-to-end coverage for ItemPicker.vue's bonus-aware preview: a candidate row
// shows not just its own stats but the stats a bonus it carries would add, resolved as if it
// were actually picked -- so the dropdown reflects what the summary panel would show.
import { test, expect, type Page } from "@playwright/test";
import {
  confirmImport,
  importText,
  openBuilder,
  pickerInput,
  slotRow,
} from "./support/app";
import {
  TEST_HEAD_BONUS,
  TEST_HEAD_ITEM,
  TEST_HEAD_ITEM_WITH_BONUS,
} from "./support/headItems";
import { importTestCatalog } from "./support/testCatalog";

// Carries its own bonus granting Combat Advantage, active the moment it's hypothetically
// equipped, with nothing else needed.
const HEAD_ITEM_WITH_BONUS = TEST_HEAD_ITEM_WITH_BONUS.name;
// Same gear_head list, but carries no `bonuses` at all: the negative control.
const HEAD_ITEM_WITHOUT_BONUS = TEST_HEAD_ITEM.name;

async function openWithHeadItems(page: Page) {
  await openBuilder(page);
  await importTestCatalog(page, {
    items: [TEST_HEAD_ITEM_WITH_BONUS, TEST_HEAD_ITEM],
    bonuses: [TEST_HEAD_BONUS],
  });
}

test.describe("item picker bonus preview", () => {
  test("a candidate that would activate a bonus shows the stats it would add", async ({
    page,
  }) => {
    await openWithHeadItems(page);
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

  test("a candidate's own dynamic stat shows in its stat line at the default", async ({
    page,
  }) => {
    await openBuilder(page);
    const name = "Test Picker Dynamic Ring";
    await importText(
      page,
      JSON.stringify({
        name: "Picker dynamic test",
        choices: {},
        catalog: {
          items: {
            "test-picker-dynamic-ring": {
              id: "test-picker-dynamic-ring",
              name,
              filter: "gear_ring",
              dynamicStats: [{ stat: "acc", min: 0, max: 1000, default: 600 }],
            },
          },
          bonuses: {},
          sectionPresets: {},
        },
      }),
    );
    await confirmImport(page);

    const row = slotRow(page, "gear.ring1");
    await pickerInput(row).click();
    const option = row
      .getByTestId("picker-menu")
      .getByTestId("picker-option")
      .filter({ hasText: name });
    await expect(option.getByTestId("picker-option-preview")).toHaveText(
      "Acc +600",
    );
  });

  test("a candidate with no bonuses at all shows no bonus preview line", async ({
    page,
  }) => {
    await openWithHeadItems(page);
    const row = slotRow(page, "gear.head");
    await pickerInput(row).click();

    const option = row
      .getByTestId("picker-menu")
      .getByTestId("picker-option")
      .filter({ hasText: HEAD_ITEM_WITHOUT_BONUS });
    // The candidate itself has to be there, or the missing line proves nothing.
    await expect(option).toHaveCount(1);
    await expect(option.getByTestId("picker-option-bonus-preview")).toHaveCount(
      0,
    );
  });

  test("picking the previewed item makes the same bonus active in the real summary", async ({
    page,
  }) => {
    await openWithHeadItems(page);
    const row = slotRow(page, "gear.head");

    await pickerInput(row).click();
    await row
      .getByTestId("picker-menu")
      .getByText(HEAD_ITEM_WITH_BONUS, { exact: true })
      .click();

    // The row's own stat summary (BuildEditor.vue's `statSummary`) now credits the same
    // bonus this item's picker row previewed before it was picked.
    await expect(row).toContainText("CA");
  });
});
