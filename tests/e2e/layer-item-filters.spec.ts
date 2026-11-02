// The layer editor's Items list filters by quality and category, and hides retired items
// until asked. A test catalog keeps the rows independent of shipped data.
import { test, expect, type Page } from "@playwright/test";
import { openBuilder, chooseCombo } from "./support/app";
import { layerRow } from "./support/nav";
import { importTestCatalog } from "./support/testCatalog";
import type { Item } from "../../src/types";

const RARE_HEAD: Item = {
  id: "test-filter-rare-head",
  name: "Test Filter Rare Head",
  filter: "gear_head",
  quality: "rare",
};
const EPIC_RING: Item = {
  id: "test-filter-epic-ring",
  name: "Test Filter Epic Ring",
  filter: "gear_ring",
  quality: "epic",
};
const RETIRED_HEAD: Item = {
  id: "test-filter-retired-head",
  name: "Test Filter Retired Head",
  filter: "gear_head",
  quality: "rare",
  hideFromPicker: true,
};

/** Opens the imported layer's Items list, searched down to this spec's items. */
async function openItems(page: Page) {
  await openBuilder(page);
  await importTestCatalog(page, {
    items: [RARE_HEAD, EPIC_RING, RETIRED_HEAD],
  });
  await layerRow(page, "Test catalog (imported)").locator(".nav-name").click();
  await page.locator(".editor-search").fill("Test Filter");
}

const rowNames = (page: Page) => page.locator(".editor-row-name");

test("retired items are hidden by default and shown on unticking", async ({
  page,
}) => {
  await openItems(page);
  const hideRetired = page.getByLabel("Hide retired");
  await expect(hideRetired).toBeChecked();
  await expect(rowNames(page)).toHaveText([EPIC_RING.name, RARE_HEAD.name]);

  await hideRetired.uncheck();
  await expect(rowNames(page)).toHaveText([
    EPIC_RING.name,
    RARE_HEAD.name,
    RETIRED_HEAD.name,
  ]);
});

test("quality and category narrow the list, and Clear filters resets them", async ({
  page,
}) => {
  await openItems(page);
  await chooseCombo(page.getByTestId("item-list-quality"), "Epic");
  await expect(rowNames(page)).toHaveText([EPIC_RING.name]);

  await chooseCombo(page.getByTestId("item-list-quality"), "any quality");
  await chooseCombo(page.getByTestId("item-list-category"), "gear_head");
  await expect(rowNames(page)).toHaveText([RARE_HEAD.name]);

  // Clearing restores the defaults, retired items hidden included.
  await page.getByLabel("Hide retired").uncheck();
  await page.getByTestId("layer-list-clear-filters").click();
  await expect(page.getByLabel("Hide retired")).toBeChecked();
  await expect(page.locator(".editor-search")).toHaveValue("");
  await page.locator(".editor-search").fill("Test Filter");
  await expect(rowNames(page)).toHaveText([EPIC_RING.name, RARE_HEAD.name]);
});
