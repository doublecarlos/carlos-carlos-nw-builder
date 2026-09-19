// Getting from "this bonus is inactive" to "here is where you would fix it": the Bonuses tab
// lists what the build carries, and its crosshairs (and the hover card's) narrow the slot list
// to what could supply the thing an unmet condition is short of.
import { test, expect, type Page } from "@playwright/test";
import {
  openBuilder,
  chooseItem,
  confirmImport,
  hoverForCard,
  importText,
  listAddButton,
  slotRow,
  slotFilterInput,
  assignmentInput,
  ensureSectionExpanded,
  cursorKey,
} from "./support/app";
import { shippedItemName } from "./support/shippedData";

/** A ring whose "(CA)" bonus needs an amethyst enchantment equipped somewhere; enchantment
 *  rows are the only ones that can hold a gem. */
const RING_SLOT = "gear.ring1";
const RING = "m33-frostsilver-coil-of-wrath";
const BONUS_ID = "m33-frostsilver-coil-of-wrath-ca";
const NEED_LOCATE = `bonus-need-locate-${BONUS_ID}-0`;
const GEM_SLOT_KEY = /^slot:enchantments\./;
const GEM_SLOT_COUNT = 8;

/** A master boon whose only bonus is a proc config defaulting to 0. At 0 points the bonus is
 *  reachable for the hover card but not on the build; with a point spent it is carried, and
 *  listed inactive until the proc is switched on. */
const BOON_SLOT = "boons.tier_master";
const BOON = "boon-master-death-s-bulwark";
const BOON_BONUS = "death-s-bulwark-stats";

/** A ring whose bonus needs the Wildspace location, an item only the scenario flags list can
 *  hold, so the one slot that could supply it is a row that may not exist yet. */
const LOCATION_RING_ID = "test-location-ring";
const LOCATION_BONUS_ID = "test-location-bonus";
const LOCATION_NEED_LOCATE = `bonus-need-locate-${LOCATION_BONUS_ID}-0`;
const SCENARIO_LIST = "options.scenario";
const LOCATION_NEED = "could supply 1× Location: Wildspace";

async function importLocationRing(page: Page) {
  await importText(
    page,
    JSON.stringify({
      name: "Location need test",
      choices: { [RING_SLOT]: LOCATION_RING_ID },
      catalog: {
        items: {
          [LOCATION_RING_ID]: {
            id: LOCATION_RING_ID,
            name: "Test Location Ring",
            filter: "gear_ring",
            bonuses: [LOCATION_BONUS_ID],
          },
        },
        bonuses: {
          [LOCATION_BONUS_ID]: {
            id: LOCATION_BONUS_ID,
            name: "Test Location Bonus",
            grants: [
              {
                when: { equipped: { item: "location-wildspace" } },
                stats: { power: 100 },
              },
            ],
          },
        },
        sectionPresets: {},
      },
    }),
  );
  await confirmImport(page);
  await expect(page.getByTestId("app-header")).toContainText(/imported/i);
}

async function openBonuses(page: Page) {
  await page.getByRole("button", { name: /Bonuses/ }).click();
  await expect(page.getByText(/active bonuses/)).toBeVisible();
}

async function openBonusesWithRing(page: Page) {
  await openBuilder(page);
  await chooseItem(page, RING_SLOT, shippedItemName(RING));
  await openBonuses(page);
}

const slotRows = (page: Page) => page.locator('[data-cursor-key^="slot:"]');

test("a bonus nothing on the build carries is not listed", async ({ page }) => {
  await openBuilder(page);
  await openBonuses(page);

  await expect(page.getByTestId(`bonus-entry-${BOON_BONUS}`)).toHaveCount(0);
});

test("a boon's proc bonus is listed, inactive, once a point is spent on the boon", async ({
  page,
}) => {
  await openBuilder(page);
  await ensureSectionExpanded(page, "boons");
  await assignmentInput(slotRow(page, BOON_SLOT), BOON).fill("1");
  await openBonuses(page);

  const entry = page.getByTestId(`bonus-entry-${BOON_BONUS}`);
  await expect(entry).toHaveAttribute("data-state", "inactive");
  // The reason is the proc control on the boon itself, one flip away from active.
  const reason = entry.getByTestId("bonus-zero-occurrence");
  await expect(reason).toContainText("Proc");
  await expect(reason).toContainText("off");
  await expect(entry.getByText("1 away")).toBeVisible();
  // Expanded, the boon is what the bonus comes from, its control notwithstanding.
  await entry.getByRole("button", { name: /Death's Bulwark Stats/ }).click();
  await expect(entry.getByTestId("bonus-from")).toHaveText(
    `from ${shippedItemName(BOON)}`,
  );

  await reason.getByRole("button", { name: shippedItemName(BOON) }).click();

  expect(await cursorKey(page)).toBe(`slot:${BOON_SLOT}`);
});

test("the tab badge counts the same bonuses the panel lists", async ({
  page,
}) => {
  await openBonusesWithRing(page);

  const badge = await page.getByTestId("bonus-tab-count").textContent();
  await expect(page.getByTestId("bonus-inspector-count")).toHaveText(
    `${badge?.trim()} active bonuses`,
  );
});

test("locating what an unmet condition needs narrows the list to slots offering matching items", async ({
  page,
}) => {
  await openBonusesWithRing(page);
  // Collapsed by hand first: a match inside a shut section is forced open, the same rule the
  // text and stat filters already follow.
  await page.getByRole("button", { name: "collapse all" }).click();

  await page.getByTestId(NEED_LOCATE).click();

  await expect(slotRows(page)).toHaveCount(GEM_SLOT_COUNT);
  const keys = await slotRows(page).evaluateAll((rows) =>
    rows.map((row) => row.getAttribute("data-cursor-key")),
  );
  for (const key of keys) expect(key).toMatch(GEM_SLOT_KEY);
  await expect(page.getByTestId("slot-filter-need")).toContainText(
    'could supply 1× item tagged "gem:amethyst"',
  );
});

test("the hover card's crosshair applies the same filter and dismisses the card", async ({
  page,
}) => {
  await openBuilder(page);
  await chooseItem(page, RING_SLOT, shippedItemName(RING));
  await hoverForCard(page, slotRow(page, RING_SLOT));
  const card = page.getByTestId("item-card");
  await expect(card).toBeVisible();

  await card
    .getByTestId("item-card-bonus-unmet")
    .filter({ hasText: "gem:amethyst" })
    .getByTestId("item-card-need-locate")
    .click();

  await expect(card).toBeHidden();
  await expect(slotRows(page)).toHaveCount(GEM_SLOT_COUNT);
  await expect(page.getByTestId("slot-filter-need")).toContainText(
    'could supply 1× item tagged "gem:amethyst"',
  );
});

test("a need only a list can supply keeps the list's add row, from the hover card", async ({
  page,
}) => {
  await openBuilder(page);
  await importLocationRing(page);
  await hoverForCard(page, slotRow(page, RING_SLOT).locator(".slot-label"));
  const card = page.getByTestId("item-card");
  await expect(card).toBeVisible();

  await card
    .getByTestId("item-card-bonus-unmet")
    .filter({ hasText: "Location: Wildspace" })
    .getByTestId("item-card-need-locate")
    .click();

  await expect(card).toBeHidden();
  await expect(page.getByTestId("slot-filter-need")).toContainText(
    LOCATION_NEED,
  );
  // The list starts empty, so the add row is the whole answer.
  await expect(listAddButton(page, SCENARIO_LIST)).toBeVisible();
  await expect(slotRows(page)).toHaveCount(1);
  await expect(page.getByTestId("slot-filter-count")).toHaveText("1 match");
});

test("a need only a list can supply keeps the list's add row, from the Bonuses tab", async ({
  page,
}) => {
  await openBuilder(page);
  await importLocationRing(page);
  await openBonuses(page);

  await page.getByTestId(LOCATION_NEED_LOCATE).click();

  await expect(page.getByTestId("slot-filter-need")).toContainText(
    LOCATION_NEED,
  );
  await expect(listAddButton(page, SCENARIO_LIST)).toBeVisible();

  // Adding a row through it keeps both the row and the add row in the narrowed list.
  await listAddButton(page, SCENARIO_LIST).click();
  await expect(slotRow(page, `${SCENARIO_LIST}#1`)).toBeVisible();
  await expect(listAddButton(page, SCENARIO_LIST)).toBeVisible();
});

test("the chip's own control drops just the supply filter", async ({
  page,
}) => {
  await openBonusesWithRing(page);
  await page.getByTestId(NEED_LOCATE).click();
  // A narrowing the user set themselves, which dropping the supply filter must not discard.
  await slotFilterInput(page).fill("ring");

  await page.getByTestId("slot-filter-need-clear").click();

  await expect(page.getByTestId("slot-filter-need")).toBeHidden();
  await expect(slotFilterInput(page)).toHaveValue("ring");
});
