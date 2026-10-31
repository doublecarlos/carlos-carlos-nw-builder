// A spec whose items are incidental imports its own small catalog, so renaming or retuning a
// shipped item never breaks it. Ids and names should read as test data ("test-..."/"Test ...").
import type { Page } from "@playwright/test";
import type { Bonus, Item } from "../../../src/types";
import { confirmImport, importText } from "./app";

export interface TestCatalog {
  items?: Item[];
  bonuses?: Bonus[];
  /** Picks for the imported build, by slot id. */
  choices?: Record<string, string>;
  /** Name of the imported build. */
  name?: string;
}

/** The import file text for a build carrying `catalog`. */
export function testCatalogText({
  items = [],
  bonuses = [],
  choices = {},
  name = "Test catalog",
}: TestCatalog): string {
  return JSON.stringify({
    name,
    choices,
    catalog: {
      items: Object.fromEntries(items.map((item) => [item.id, item])),
      bonuses: Object.fromEntries(bonuses.map((bonus) => [bonus.id, bonus])),
      sectionPresets: {},
    },
  });
}

/** Imports `catalog` as a new build and confirms the import picker. */
export async function importTestCatalog(page: Page, catalog: TestCatalog) {
  await importText(page, testCatalogText(catalog));
  await confirmImport(page);
}
