// A plain Head item for specs that only need something to equip, so a shipped head's rename or
// retune never breaks them.
import type { Page } from "@playwright/test";
import type { Item } from "../../../src/types";
import { importTestCatalog } from "./testCatalog";

/** No item level, so it sorts to the bottom of the Head picker. */
export const TEST_HEAD: Item = {
  id: "test-head",
  name: "Test Head",
  filter: "gear_head",
};

/** Imports a catalog holding `TEST_HEAD` and `items`, as a new build. */
export async function importTestHead(page: Page, items: Item[] = []) {
  await importTestCatalog(page, {
    name: "Test head",
    items: [TEST_HEAD, ...items],
  });
}
