// End-to-end coverage for ItemPicker.vue's "potential" bonus preview: a candidate
// that contributes to a bonus which isn't active yet shows a "Potentially:" line for what it
// would add once the rest of the bonus is in place, sourced from the same per-candidate resolve
// the "current" bonus preview already runs.
import { test, expect, type Page } from "@playwright/test";
import { openBuilder, slotRow, pickerInput, chooseItem } from "./support/app";
import { importTestCatalog } from "./support/testCatalog";

// The pants carry two bonuses: one of their own, active alone, and half of a 2-occurrence
// bonus whose other half is the shirt. So the pants are worth something on their own *and*
// have a further "Potentially:" ceiling once the shirt is in place.
const PANTS_ITEM = "Test Potential Pants";
const SHIRT_ITEM = "Test Potential Shirt";
const OWN_BONUS = "test-potential-own";
const PAIR_BONUS = "test-potential-pair";

async function importPair(page: Page) {
  await importTestCatalog(page, {
    items: [
      {
        id: "test-potential-pants",
        name: PANTS_ITEM,
        filter: "gear_pants",
        bonuses: [OWN_BONUS, PAIR_BONUS],
      },
      {
        id: "test-potential-shirt",
        name: SHIRT_ITEM,
        filter: "gear_shirt",
        bonuses: [PAIR_BONUS],
      },
    ],
    bonuses: [
      {
        id: OWN_BONUS,
        name: "Test Potential Own",
        grants: [{ stats: { ca_p: 0.1 } }],
      },
      {
        id: PAIR_BONUS,
        name: "Test Potential Pair",
        grants: [
          {
            when: { bonusOccurrences: { atLeast: 2 } },
            stats: { ca_p: 0.02 },
          },
        ],
      },
    ],
  });
}

test.describe("item picker potential bonus preview", () => {
  test("a candidate that would only partially complete a bonus shows both its own active bonus and an 'Potentially:' ceiling", async ({
    page,
  }) => {
    await openBuilder(page);
    await importPair(page);
    const row = slotRow(page, "gear.pants");
    await pickerInput(row).click();

    const option = row
      .getByTestId("picker-menu")
      .getByTestId("picker-option")
      .filter({ hasText: PANTS_ITEM });

    // Its own bonus (not gated on the occurrence count) is active the moment it's hypothetically
    // equipped.
    await expect(
      option.getByTestId("picker-option-bonus-preview"),
    ).toContainText("CA +10.00%");

    // Only one of the bonus's two occurrences would be equipped -- that half stays a "ceiling".
    const potential = option.getByTestId("picker-option-potential-preview");
    await expect(potential).toContainText("Potentially:");
    await expect(potential).toContainText("CA +2.00%");
  });

  test("once the bonus would actually complete, the potential line drops (nothing inactive left to show)", async ({
    page,
  }) => {
    await openBuilder(page);
    await importPair(page);
    // Equip the other item for real first, so the pants candidate would complete the bonus.
    await chooseItem(page, "gear.shirt", SHIRT_ITEM);

    const row = slotRow(page, "gear.pants");
    await pickerInput(row).click();
    const option = row
      .getByTestId("picker-menu")
      .getByTestId("picker-option")
      .filter({ hasText: PANTS_ITEM });

    // The near-miss bucket only ever holds *inactive* contributions -- now that the bonus
    // is active too (credited to gear.shirt, the bonus's other/earlier slot -- the engine's own
    // attribution, unchanged by this feature), there is nothing inactive left for pants to show.
    await expect(
      option.getByTestId("picker-option-potential-preview"),
    ).toHaveCount(0);
  });
});
