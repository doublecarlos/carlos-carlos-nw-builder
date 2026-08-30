// End-to-end coverage for ItemPicker.vue's "potential" bonus preview: a candidate
// that contributes to a bonus which isn't active yet shows a "Potentially:" line for what it
// would add once the rest of the bonus is in place, sourced from the same per-candidate resolve
// the "current" bonus preview already runs.
import { test, expect } from "@playwright/test";
import { openBuilder, slotRow, pickerInput, chooseItem } from "./support/app";

// M31 Bloodwoven Sigils carries two bonuses: M31 Reckless Advantage (its own, active on
// the "combat" toggle alone -- CA +10%/Crit Avoid -7.5%) and half of M31 Enchanted Advantage,
// a 2-occurrence bonus granting `ca_p +0.02` only once both items are equipped. That combination
// is exactly the case here: an item that's already worth something on its own, *and*
// a further "Potentially:" ceiling once the rest of the bonus is in place. The bonus's other
// item lives in gear.shirt.
const PANTS_ITEM = "M31 Bloodwoven Sigils";
const SHIRT_ITEM = "M31 Bloodwoven Signs";

test.describe("item picker potential bonus preview", () => {
  test("a candidate that would only partially complete a bonus shows both its own active bonus and an 'Potentially:' ceiling", async ({
    page,
  }) => {
    await openBuilder(page);
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

// Same fixture slot-list.spec.ts/stat-panel.spec.ts already rely on: has an `il` badge and
// several flat item stats to show as the innate-stat line.
const HEAD_ITEM = "M29 Enchanted Depthweave Cap";

test.describe("item picker option row layout", () => {
  test("the item name is bold, and innate stats are no longer muted text", async ({
    page,
  }) => {
    await openBuilder(page);
    const row = slotRow(page, "gear.head");
    await pickerInput(row).click();

    const option = row
      .getByTestId("picker-menu")
      .getByTestId("picker-option")
      .filter({ hasText: HEAD_ITEM });
    await expect(option.locator("span").first()).toHaveCSS(
      "font-weight",
      "600",
    );

    // The item-level (iL) badge kept its muted styling; the innate-stat line beneath the name
    // (the indented block's first row) is a different color now that it's no longer muted --
    // proves the two diverged rather than asserting one exact color value.
    const ilBadge = option.getByText(/^iL /);
    const innateStats = option.locator(".pl-2 > div").first();
    await expect(innateStats).toContainText("CR");
    const [ilColor, innateColor] = await Promise.all([
      ilBadge.evaluate((el) => getComputedStyle(el).color),
      innateStats.evaluate((el) => getComputedStyle(el).color),
    ]);
    expect(innateColor).not.toBe(ilColor);
  });
});
