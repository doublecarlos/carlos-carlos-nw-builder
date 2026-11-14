// A spec whose items are incidental imports its own small catalog, so renaming or retuning a
// shipped item never breaks it. Ids and names should read as test data ("test-..."/"Test ...").
import type { Page } from "@playwright/test";
import type { Bonus, FilterDef, Item, TagDef } from "../../../src/types";
import { confirmImport, importText } from "./app";

export interface TestCatalog {
  items?: Item[];
  bonuses?: Bonus[];
  /** Tag declarations, as data/vocabulary.json's `tags` section would hold them. */
  tags?: TagDef[];
  /** Category declarations, as data/vocabulary.json's `filters` section would hold them. */
  filters?: FilterDef[];
  /** Picks for the imported build, by slot id. */
  choices?: Record<string, string>;
  /** Name of the imported build. */
  name?: string;
}

/** The import file text for a build carrying `catalog`. */
export function testCatalogText({
  items = [],
  bonuses = [],
  tags = [],
  filters = [],
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
      ...(tags.length && {
        tags: Object.fromEntries(tags.map((tag) => [tag.id, tag])),
      }),
      ...(filters.length && {
        filters: Object.fromEntries(
          filters.map((filter) => [filter.id, filter]),
        ),
      }),
    },
  });
}

/** Imports `catalog` as a new build and confirms the import picker. */
export async function importTestCatalog(page: Page, catalog: TestCatalog) {
  await importText(page, testCatalogText(catalog));
  await confirmImport(page);
}
