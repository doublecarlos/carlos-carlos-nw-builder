// End-to-end coverage for ItemPicker.vue's "potential" bonus preview (issue #125): a candidate
// that contributes to a set bonus which isn't active yet shows an "Up to:" line for what it
// would add once the rest of the set is in place, sourced from the same per-candidate resolve
// the "current" bonus preview (#116) already runs.
import { test, expect } from "@playwright/test";
import { openBuilder, slotRow, pickerInput, chooseItem } from "./support/app";

// M31 Bloodwoven Sigils (CA) carries two bonuses: M31 Reckless Advantage (its own, active on
// the "combat" toggle alone -- CA +10%/Crit Avoid -7.5%) and half of M31 Enchanted Advantage,
// a 2-piece set granting `ca_p +0.02` only once both pieces are equipped. That combination is
// exactly the case #125 is about: an item that's already worth something on its own, *and*
// a further "Up to:" ceiling once the rest of the set is in place. The set's other piece lives
// in gear.shirt.
const PANTS_PIECE = "M31 Bloodwoven Sigils (CA)";
const SHIRT_PIECE = "M31 Bloodwoven Signs (Damage)";

test.describe("item picker potential bonus preview", () => {
  test("a candidate that would only partially complete a set shows both its own active bonus and an 'Up to:' ceiling", async ({
    page,
  }) => {
    await openBuilder(page);
    const row = slotRow(page, "gear.pants");
    await pickerInput(row).click();

    const option = row
      .getByTestId("picker-menu")
      .getByTestId("picker-option")
      .filter({ hasText: PANTS_PIECE });

    // Its own bonus (not gated on the set) is active the moment it's hypothetically equipped.
    await expect(
      option.getByTestId("picker-option-bonus-preview"),
    ).toContainText("CA +10.00%");

    // Only one piece of the 2-piece set would be equipped -- that half stays a "ceiling".
    const potential = option.getByTestId("picker-option-potential-preview");
    await expect(potential).toContainText("Up to:");
    await expect(potential).toContainText("CA +2.00%");
  });

  test("once the set would actually complete, the potential line drops (nothing inactive left to show)", async ({
    page,
  }) => {
    await openBuilder(page);
    // Equip the other piece for real first, so the pants candidate would complete the set.
    await chooseItem(page, "gear.shirt", SHIRT_PIECE);

    const row = slotRow(page, "gear.pants");
    await pickerInput(row).click();
    const option = row
      .getByTestId("picker-menu")
      .getByTestId("picker-option")
      .filter({ hasText: PANTS_PIECE });

    // The near-miss bucket only ever holds *inactive* contributions -- now that the set bonus
    // is active too (credited to gear.shirt, the set's other/earlier slot -- the engine's own
    // attribution, unchanged by this feature), there is nothing inactive left for pants to show.
    await expect(
      option.getByTestId("picker-option-potential-preview"),
    ).toHaveCount(0);
  });
});

// Same fixture slot-list.spec.ts/stat-panel.spec.ts already rely on: has an `il` badge and
// several flat item stats to show as the innate-stat line.
const HEAD_ITEM = "M29 Enchanted Depthweave Cap (CA)";

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
