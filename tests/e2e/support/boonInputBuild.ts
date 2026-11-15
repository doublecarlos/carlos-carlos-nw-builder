// A build with a point on each of three test boons on the Tier 1 row, two of them carrying a
// bonus with an on/off input, so the row lists bonus inputs without leaning on shipped data.
import type { Page } from "@playwright/test";
import { confirmImport, importText, openBuilder, slotRow } from "./app";

export const BOON_SLOT = "boons.tier1";
/** In catalog and id order. Priority sorts the steppers the other way round, last boon
 *  first, so a test can tell stepper order from either. The middle boon has no input. */
export const BOONS = ["test-boon-first", "test-boon-plain", "test-boon-last"];
export const FIRST_BONUS = "test-boon-first-proc";
export const LAST_BONUS = "test-boon-last-proc";

const proc = (label: string) => ({
  active: { type: "boolean", default: false, label },
});

const GRANTS = [
  { when: { input: { key: "active", is: true } }, stats: { power: 5 } },
];

const boon = (id: string, priority: number, bonuses: string[]) => ({
  id,
  name: `Test ${id}`,
  filter: "boon_tier1",
  inlineRepetition: { min: 0, max: 3, default: 0, priority },
  bonuses,
});

const build = {
  name: "Boon input row test",
  choices: {},
  assignments: {
    [BOON_SLOT]: { [BOONS[0]]: 1, [BOONS[1]]: 1, [BOONS[2]]: 1 },
  },
  catalog: {
    items: {
      [BOONS[0]]: boon(BOONS[0], 3, [FIRST_BONUS]),
      [BOONS[1]]: boon(BOONS[1], 2, []),
      [BOONS[2]]: boon(BOONS[2], 1, [LAST_BONUS]),
    },
    bonuses: {
      [FIRST_BONUS]: {
        id: FIRST_BONUS,
        name: "Test First Proc",
        inputs: proc("Test first boon's proc"),
        grants: GRANTS,
      },
      [LAST_BONUS]: {
        id: LAST_BONUS,
        name: "Test Last Proc",
        inputs: proc("Test last boon's proc"),
        grants: GRANTS,
      },
    },
    sectionPresets: {},
  },
};

/** Opens the builder on the imported build and returns the boon row. */
export async function openWithBoonInputs(page: Page) {
  await openBuilder(page);
  await importText(page, JSON.stringify(build));
  await confirmImport(page);
  const row = slotRow(page, BOON_SLOT);
  await row.scrollIntoViewIfNeeded();
  return row;
}
