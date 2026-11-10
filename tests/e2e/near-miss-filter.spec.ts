// Getting from "this bonus is inactive" to "here is where you would fix it": the Bonuses tab
// lists what the build carries, and its crosshairs (and the hover card's) narrow the slot list
// to what could supply the thing an unmet condition is short of.
import { test, expect, type Page } from "@playwright/test";
import {
  openBuilder,
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
import { importTestCatalog } from "./support/testCatalog";

/** A ring whose bonus needs a test-only gem equipped somewhere. The gem is a utility
 *  enchantment, so the utility slot is the one row that can supply it. */
const RING_SLOT = "gear.ring1";
const RING = "test-gem-ring";
const BONUS_ID = "test-gem-bonus";
const NEED_LOCATE = `bonus-need-locate-${BONUS_ID}-0`;
const GEM_TAG = "test:gem";
const GEM_SLOT_KEY = "slot:enchantments.utility";

/** A master boon whose only bonus has a proc input defaulting to off. At 0 points the bonus is
 *  reachable for the hover card but not on the build; with a point spent it is carried, and
 *  listed inactive until the proc is switched on. */
const BOON_SLOT = "boons.tier_master";
const BOON = "test-proc-boon";
const BOON_NAME = "Test Proc Boon";
const BOON_BONUS = "test-proc-boon-stats";
const BOON_BONUS_NAME = "Test Proc Boon Stats";

async function importGemRing(page: Page) {
  await importTestCatalog(page, {
    choices: { [RING_SLOT]: RING },
    items: [
      {
        id: RING,
        name: "Test Gem Ring",
        filter: "gear_ring",
        bonuses: [BONUS_ID],
      },
      {
        id: "test-gem",
        name: "Test Gem",
        filter: "enchantment_utility",
        tags: [GEM_TAG],
      },
    ],
    bonuses: [
      {
        id: BONUS_ID,
        name: "Test Gem Bonus",
        grants: [
          {
            when: { equipped: { tag: GEM_TAG } },
            stats: { ca_p: 0.03 },
          },
        ],
      },
    ],
  });
}

async function importProcBoon(page: Page) {
  await importTestCatalog(page, {
    items: [
      {
        id: BOON,
        name: BOON_NAME,
        filter: "boon_tier_master",
        bonuses: [BOON_BONUS],
        inlineRepetition: { min: 0, max: 3, default: 0 },
      },
    ],
    bonuses: [
      {
        id: BOON_BONUS,
        name: BOON_BONUS_NAME,
        inputs: {
          active: { type: "boolean", label: "Proc", default: false },
        },
        grants: [
          {
            when: { input: { key: "active", is: true } },
            stats: { defense_p: 0.02 },
          },
        ],
      },
    ],
  });
}

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
  await importGemRing(page);
  await openBonuses(page);
}

/** Rows the filter leaves on screen. The ones it drops stay mounted, hidden. */
const slotRows = (page: Page) =>
  page.locator('[data-cursor-key^="slot:"]:visible');

/** The filter keeps exactly the slot that can hold the test gem and hides every other row. */
async function expectOnlyGemSlot(page: Page) {
  await expect(slotRows(page)).toHaveCount(1);
  await expect(slotRows(page)).toHaveAttribute("data-cursor-key", GEM_SLOT_KEY);
}

test("a bonus nothing on the build carries is not listed", async ({ page }) => {
  await openBuilder(page);
  await importProcBoon(page);
  await openBonuses(page);

  await expect(page.getByTestId(`bonus-entry-${BOON_BONUS}`)).toHaveCount(0);
});

test("a boon's proc bonus is listed, inactive, once a point is spent on the boon", async ({
  page,
}) => {
  await openBuilder(page);
  await importProcBoon(page);
  await ensureSectionExpanded(page, "boons");
  await assignmentInput(slotRow(page, BOON_SLOT), BOON).fill("1");
  await openBonuses(page);

  const entry = page.getByTestId(`bonus-entry-${BOON_BONUS}`);
  await expect(entry).toHaveAttribute("data-state", "inactive");
  // The reason is the proc input on the boon itself, one flip away from active.
  await expect(entry).toContainText("Proc on");
  await expect(entry.getByText("1 away")).toBeVisible();
  // Expanded, the boon is what the bonus comes from.
  await entry.getByRole("button", { name: BOON_BONUS_NAME }).click();
  const from = entry.getByTestId("bonus-from");
  await expect(from).toHaveText(`from ${BOON_NAME}`);

  await from.getByRole("button", { name: BOON_NAME }).click();

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

  await expectOnlyGemSlot(page);
  await expect(page.getByTestId("slot-filter-need")).toContainText(
    `could supply 1× item tagged "${GEM_TAG}"`,
  );
});

test("the hover card's crosshair applies the same filter and dismisses the card", async ({
  page,
}) => {
  await openBuilder(page);
  await importGemRing(page);
  await hoverForCard(page, slotRow(page, RING_SLOT));
  const card = page.getByTestId("item-card");
  await expect(card).toBeVisible();

  await card
    .getByTestId("item-card-bonus-unmet")
    .filter({ hasText: GEM_TAG })
    .getByTestId("item-card-need-locate")
    .click();

  await expect(card).toBeHidden();
  await expectOnlyGemSlot(page);
  await expect(page.getByTestId("slot-filter-need")).toContainText(
    `could supply 1× item tagged "${GEM_TAG}"`,
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
