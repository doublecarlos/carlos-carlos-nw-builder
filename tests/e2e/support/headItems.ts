// Test head items for specs that only need something to pick in the head row.
import type { Bonus, Item } from "../../../src/types";

export const TEST_HEAD_ITEM: Item = {
  id: "test-head-item",
  name: "Test Head Item",
  filter: "gear_head",
};

/** Grants Combat Advantage through its own bonus, with no condition, so the bonus is active
 *  the moment the item is (or would be) picked. */
export const TEST_HEAD_BONUS: Bonus = {
  id: "test-head-bonus",
  name: "Test Head Bonus",
  grants: [{ stats: { ca_p: 0.1 } }],
};

export const TEST_HEAD_ITEM_WITH_BONUS: Item = {
  id: "test-bonus-head-item",
  name: "Test Bonus Head Item",
  filter: "gear_head",
  bonuses: [TEST_HEAD_BONUS.id],
};
