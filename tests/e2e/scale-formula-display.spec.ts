// How the hover card shows a scale formula: the step ladder its `steps` hint asks for, the
// values a compound one read, and the link that opens the bonus in the inspector.
import { test, expect, type Page } from "@playwright/test";
import { confirmImport, importText, openBuilder, slotRow } from "./support/app";

const RING_ID = "test-ramp-ring";
const BONUS_ID = "test-ramp-bonus";
const OTHER_RING_ID = "test-plain-ring";
/** Contains `BONUS_ID`, so only an exact match leaves it out. */
const OTHER_BONUS_ID = `${BONUS_ID}-plain`;

/** A ring whose bonus halves its return per stack, laddered over 0 to 3 stacks when
 *  `stepped`, beside a ring with a plain bonus. */
async function openWithRamp(page: Page, stacks: number, stepped: boolean) {
  await openBuilder(page);
  await importText(
    page,
    JSON.stringify({
      name: "Ramp test",
      choices: { "gear.ring1": RING_ID, "gear.ring2": OTHER_RING_ID },
      bonusValues: { [BONUS_ID]: { input: { stacks } } },
      catalog: {
        items: {
          [RING_ID]: {
            id: RING_ID,
            name: "Test Ramp Ring",
            filter: "gear_ring",
            bonuses: [BONUS_ID],
          },
          [OTHER_RING_ID]: {
            id: OTHER_RING_ID,
            name: "Test Plain Ring",
            filter: "gear_ring",
            bonuses: [OTHER_BONUS_ID],
          },
        },
        bonuses: {
          [OTHER_BONUS_ID]: {
            id: OTHER_BONUS_ID,
            name: "Test Plain Bonus",
            grants: [{ stats: { power: 1 } }],
          },
          [BONUS_ID]: {
            id: BONUS_ID,
            name: "Test Ramp Bonus",
            inputs: {
              stacks: {
                type: "number",
                min: 0,
                max: 3,
                default: 0,
                label: "Stacks",
              },
            },
            grants: [
              {
                stats: { power: 100 },
                scale: {
                  formula: "geometric($stacks, 0.5)",
                  ...(stepped && {
                    steps: { over: "$stacks", min: 0, max: 3, step: 1 },
                  }),
                },
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
  const row = slotRow(page, "gear.ring1");
  await row.scrollIntoViewIfNeeded();
  await row.hover();
  return page.getByTestId("item-card");
}

test("a scale with steps lists the payload at every stack", async ({
  page,
}) => {
  const card = await openWithRamp(page, 2, true);
  const ladder = card.getByTestId("item-card-ladder");
  await expect(ladder).toContainText("Stacks 1:");
  await expect(ladder).toContainText("Stacks 2:");
  await expect(ladder).toContainText("Stacks 3:");
  await expect(ladder).toContainText("Power+175");
});

test("a scale without steps keeps one line, noting what it read", async ({
  page,
}) => {
  const card = await openWithRamp(page, 2, false);
  await expect(card.getByTestId("item-card-ladder")).toHaveCount(0);
  await expect(card).toContainText("100 x 1.5 (Stacks: 2)");
});

test("the card's formula link filters the inspector down to exactly the bonus", async ({
  page,
}) => {
  const card = await openWithRamp(page, 2, false);
  await card.getByTestId("item-card-inspect").click();
  const entry = page.getByTestId(`bonus-entry-${BONUS_ID}`);
  await expect(entry).toBeInViewport();
  await expect(entry.getByTestId("bonus-formulas")).toContainText(
    "geometric($stacks, 0.5)",
  );
  const filter = page.getByTestId("bonus-filter");
  await expect(filter).toHaveValue(BONUS_ID);
  const other = page.getByTestId(`bonus-entry-${OTHER_BONUS_ID}`);
  await expect(other).toHaveCount(0);

  // Clearing the filter brings the rest of the build's bonuses back.
  await page.getByTestId("bonus-filter-clear").click();
  await expect(other).toBeVisible();
});
