// End-to-end coverage for BuildEditor.vue's text/stat slot filter: narrowing the
// visible slots and sections, the section-header-match override, forcing a matching but
// manually-collapsed section back open, and the clear-filters affordance. Also covers matching
// on a slot's current choice and its rendered stat summary.
import { test, expect, type Page } from "@playwright/test";
import {
  confirmImport,
  importText,
  openBuilder,
  headerRow,
  slotRow,
  chooseCombo,
  chooseItem,
  slotFilterInput,
  slotFilterStatCombo,
  slotFilterClearButton,
} from "./support/app";
import { expectTopmost } from "./support/occlusion";
import { importTestCatalog } from "./support/testCatalog";

const DYNAMIC_RING_SLOT = "gear.ring1";
// "Glimmer" is the word no slot or section label carries.
const ARMS_ITEM = "Test Glimmer Armguards";
const FOOD_ITEM = "Test Filter Food";

/** Imports a build holding one catalog ring, made of `fields`, in `DYNAMIC_RING_SLOT`. */
async function importRing(page: Page, fields: Record<string, unknown>) {
  const id = "test-filter-ring";
  await importText(
    page,
    JSON.stringify({
      name: "Ring filter test",
      choices: { [DYNAMIC_RING_SLOT]: id },
      catalog: {
        items: {
          [id]: {
            id,
            name: "Test Filter Ring",
            filter: "gear_ring",
            ...fields,
          },
        },
        bonuses: {},
        sectionPresets: {},
      },
    }),
  );
  await confirmImport(page);
  await expect(page.getByTestId("app-header")).toContainText(/imported/i);
}

/** Arms granting Power and Accuracy directly, and food granting Power only through its active
 *  bonus. Nothing equipped. */
const importFilterItems = (page: Page) =>
  importTestCatalog(page, {
    items: [
      {
        id: "test-filter-arms",
        name: ARMS_ITEM,
        filter: "gear_arms",
        power: 100,
        acc: 100,
      },
      {
        id: "test-filter-food",
        name: FOOD_ITEM,
        filter: "consumable_food",
        bonuses: ["test-filter-food-power"],
      },
    ],
    bonuses: [
      {
        id: "test-filter-food-power",
        name: "Test Filter Food Power",
        grants: [{ stats: { power: 100 } }],
      },
    ],
  });

/** A ring whose only stat is Accuracy the player types in. */
const importDynamicRing = (page: Page) =>
  importRing(page, {
    dynamicStats: [{ stat: "acc", min: 0, max: 1000, default: 500 }],
  });

test.describe("slot filter: text", () => {
  test("typing a slot label shows only matching slots and hides sections with no match", async ({
    page,
  }) => {
    await openBuilder(page);
    await slotFilterInput(page).fill("Arms");

    await expect(slotRow(page, "gear.arms")).toBeVisible();
    await expect(slotRow(page, "gear.head")).toBeHidden();
    // Options has no slot or header matching "Arms", so it disappears entirely.
    await expect(headerRow(page, "options")).toBeHidden();
  });

  test("a matching section header shows every slot underneath, unfiltered", async ({
    page,
  }) => {
    await openBuilder(page);
    await slotFilterInput(page).fill("Options");

    await expect(headerRow(page, "options")).toBeVisible();
    await expect(slotRow(page, "options.class")).toBeVisible();
    await expect(slotRow(page, "options.role")).toBeVisible();
  });

  test("filtering forces a manually-collapsed matching section back open", async ({
    page,
  }) => {
    await openBuilder(page);
    await headerRow(page, "gear").click();
    await expect(slotRow(page, "gear.head")).toBeHidden();

    await slotFilterInput(page).fill("Head");
    await expect(slotRow(page, "gear.head")).toBeVisible();
  });

  test("clearing the filter restores the collapse state from before filtering", async ({
    page,
  }) => {
    await openBuilder(page);
    await headerRow(page, "gear").click();
    await expect(slotRow(page, "gear.head")).toBeHidden();

    await slotFilterInput(page).fill("Head");
    await expect(slotRow(page, "gear.head")).toBeVisible();

    await slotFilterClearButton(page).click();
    await expect(slotRow(page, "gear.head")).toBeHidden();
  });

  test("typing the name of a slot's current choice matches it", async ({
    page,
  }) => {
    await openBuilder(page);
    await importFilterItems(page);
    await chooseItem(page, "gear.arms", ARMS_ITEM);

    await slotFilterInput(page).fill("Glimmer");
    await expect(slotRow(page, "gear.arms")).toBeVisible();
    await expect(slotRow(page, "gear.head")).toBeHidden();
  });

  test("an empty slot never matches an item name query", async ({ page }) => {
    await openBuilder(page);
    await importFilterItems(page);

    await slotFilterInput(page).fill("Glimmer");
    await expect(slotRow(page, "gear.arms")).toBeHidden();
  });

  test("typing text from a slot's rendered stat summary matches it", async ({
    page,
  }) => {
    await openBuilder(page);
    await importFilterItems(page);
    await chooseItem(page, "gear.arms", ARMS_ITEM);

    // The armguards grant Accuracy directly. Its abbreviation shows in the stat summary
    // rendered next to the picker, and nothing else on the page's slot/section labels does.
    await slotFilterInput(page).fill("Acc ");
    await expect(slotRow(page, "gear.arms")).toBeVisible();
    await expect(slotRow(page, "gear.head")).toBeHidden();
  });

  test("a dynamic stat's value shows in the stat summary it matches against", async ({
    page,
  }) => {
    await openBuilder(page);
    await importDynamicRing(page);

    await slotFilterInput(page).fill("Acc ");
    await expect(slotRow(page, DYNAMIC_RING_SLOT)).toBeVisible();
    await expect(slotRow(page, "gear.head")).toBeHidden();
  });

  test("a repeated item's summary shows the total of every copy", async ({
    page,
  }) => {
    await openBuilder(page);
    await importRing(page, {
      power: 111,
      inlineRepetition: { min: 0, max: 4, default: 3 },
    });

    await expect(slotRow(page, DYNAMIC_RING_SLOT)).toContainText("+333");
    await slotFilterInput(page).fill("333");
    await expect(slotRow(page, DYNAMIC_RING_SLOT)).toBeVisible();
    await slotFilterInput(page).fill("111");
    await expect(slotRow(page, DYNAMIC_RING_SLOT)).toBeHidden();
  });

  test("multiple whitespace-separated words each match, even across different fields", async ({
    page,
  }) => {
    await openBuilder(page);
    await importFilterItems(page);
    await chooseItem(page, "gear.arms", ARMS_ITEM);

    // "Arms" matches the slot label, "Glimmer" matches the equipped item's name. Neither word
    // alone is enough to prove the AND-across-words behavior, only both together.
    await slotFilterInput(page).fill("Arms Glimmer");
    await expect(slotRow(page, "gear.arms")).toBeVisible();
    await expect(slotRow(page, "gear.head")).toBeHidden();

    // A word that matches nothing on this slot drops it out, even though the other word
    // still matches.
    await slotFilterInput(page).fill("Arms Nonexistent");
    await expect(slotRow(page, "gear.arms")).toBeHidden();
  });
});

test.describe("slot filter: stat", () => {
  test("an empty slot never matches, even though a selectable item would grant the stat", async ({
    page,
  }) => {
    await openBuilder(page);
    await importFilterItems(page);
    // ARMS_ITEM is selectable in gear.arms and grants power directly, but nothing is equipped
    // there. The filter is about what a slot's current choice grants, not what it could.
    await chooseCombo(slotFilterStatCombo(page), "Power");
    await expect(slotRow(page, "gear.arms")).toBeHidden();
  });

  test("selecting a stat shows only slots whose currently equipped item grants it", async ({
    page,
  }) => {
    await openBuilder(page);
    await importFilterItems(page);
    await chooseItem(page, "gear.arms", ARMS_ITEM);

    await chooseCombo(slotFilterStatCombo(page), "Power");

    // gear.arms is now equipped with an item granting power directly; gear.head is empty.
    await expect(slotRow(page, "gear.arms")).toBeVisible();
    await expect(slotRow(page, "gear.head")).toBeHidden();
  });

  test("text and stat filters combine", async ({ page }) => {
    await openBuilder(page);
    await importFilterItems(page);
    await chooseItem(page, "gear.arms", ARMS_ITEM);

    await slotFilterInput(page).fill("Arms");
    await chooseCombo(slotFilterStatCombo(page), "Power");
    await expect(slotRow(page, "gear.arms")).toBeVisible();

    // Switch the text query to something only (empty) Head matches -- now nothing in gear
    // satisfies both filters at once, and the whole section disappears.
    await slotFilterInput(page).fill("Head");
    await expect(headerRow(page, "gear")).toBeHidden();
  });

  test("a slot also matches through an active bonus, not just an item's own stats", async ({
    page,
  }) => {
    await openBuilder(page);
    await importFilterItems(page);
    // FOOD_ITEM carries no `power` stat of its own. It grants Power through an active bonus
    // once equipped, so the Food slot only matches the Power filter after it's chosen.
    await chooseCombo(slotFilterStatCombo(page), "Power");
    await expect(slotRow(page, "buffs.food")).toBeHidden();

    await slotFilterClearButton(page).click();
    await chooseItem(page, "buffs.food", FOOD_ITEM);

    await chooseCombo(slotFilterStatCombo(page), "Power");
    await expect(slotRow(page, "buffs.food")).toBeVisible();
  });

  test("a slot matches through its item's own dynamic stat", async ({
    page,
  }) => {
    await openBuilder(page);
    await importDynamicRing(page);

    await chooseCombo(slotFilterStatCombo(page), "Accuracy");
    await expect(slotRow(page, DYNAMIC_RING_SLOT)).toBeVisible();
    await expect(slotRow(page, "gear.head")).toBeHidden();
  });
});

test.describe("clear filters button", () => {
  test("is disabled with no filter applied, and enables once one is", async ({
    page,
  }) => {
    await openBuilder(page);
    await expect(slotFilterClearButton(page)).toBeDisabled();

    await slotFilterInput(page).fill("Arms");
    await expect(slotFilterClearButton(page)).toBeEnabled();

    await slotFilterClearButton(page).click();
    await expect(slotFilterInput(page)).toHaveValue("");
    await expect(slotFilterClearButton(page)).toBeDisabled();
  });

  test("shows a match count while a filter is active", async ({ page }) => {
    await openBuilder(page);
    await expect(page.getByTestId("slot-filter-count")).toBeHidden();

    await slotFilterInput(page).fill("Arms");
    // Arms only: its reinforcement is hidden while Arms is empty.
    await expect(page.getByTestId("slot-filter-count")).toHaveText("1 match");
  });
});

test.describe("stat filter menu stacking", () => {
  test("the open menu paints over everything under it", async ({ page }) => {
    await openBuilder(page);
    await slotFilterStatCombo(page).getByTestId("picker-input").click();

    const menu = slotFilterStatCombo(page).getByTestId("picker-menu");
    await expect(menu).toBeVisible();

    // The menu drops out of the sticky toolbar and over the section list, whose own headers
    // are sticky too: every point down the menu has to land inside it, or a header is
    // painting on top and swallowing the clicks meant for an option.
    await expectTopmost(menu);
  });
});
