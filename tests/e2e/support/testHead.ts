// Test Head items for specs that only need something to equip, so a shipped head's rename or
// retune never breaks them.
import type { Page } from "@playwright/test";
import type { Bonus, Item } from "../../../src/types";
import { importTestCatalog } from "./testCatalog";

/** No item level, so it sorts to the bottom of the Head picker. */
export const TEST_HEAD: Item = {
  id: "test-head",
  name: "Test Head",
  filter: "gear_head",
};

/** Grants Combat Advantage with no condition, so it's active the moment its item is (or would
 *  be) picked. */
export const TEST_HEAD_BONUS: Bonus = {
  id: "test-head-bonus",
  name: "Test Head Bonus",
  grants: [{ stats: { ca_p: 0.1 } }],
};

export const TEST_HEAD_WITH_BONUS: Item = {
  id: "test-bonus-head",
  name: "Test Bonus Head",
  filter: "gear_head",
  bonuses: [TEST_HEAD_BONUS.id],
};

/** Imports a catalog holding `TEST_HEAD` and `items`, as a new build. */
export async function importTestHead(page: Page, items: Item[] = []) {
  await importTestCatalog(page, {
    name: "Test head",
    items: [TEST_HEAD, ...items],
  });
}
