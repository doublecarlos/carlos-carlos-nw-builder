// End-to-end coverage for issue #138: an item can author a short description, shown next to
// the row's stat summary, and a long description, shown on the item's hover card -- for an
// effect that reads better as text than as a stat (e.g. a proc).
import { test, expect, type Page } from "@playwright/test";
import { openBuilder, slotRow, chooseItem } from "./support/app";
import { addLayer, layerRow } from "./support/nav";

const SLOT_ID = "gear.head";
const SHORT_DESCRIPTION = "AP when killing mobs";
const LONG_DESCRIPTION = "When you kill an enemy, gain 3% Action Points.";

/** Authors a brand-new item with both description fields set, via a fresh layer, and
 *  equips it in `SLOT_ID` -- keeps this spec's coverage independent of any shipped item
 *  carrying description text of its own. */
async function createAndEquipDescribedItem(page: Page, name: string) {
  await openBuilder(page);
  await addLayer(page);
  await layerRow(page, "Layer 1").locator(".nav-name").click();
  await page.getByTestId("new-item").click();
  await page.getByTestId("item-name-input").fill(name);
  await page.getByTestId("item-filter-input").fill("gear_head");
  await page.getByTestId("add-item-description").click();
  await page
    .getByTestId("item-short-description-input")
    .fill(SHORT_DESCRIPTION);
  await page.getByTestId("item-long-description-input").fill(LONG_DESCRIPTION);
  await page.getByRole("button", { name: "Save item" }).click();

  await page.getByRole("button", { name: "Build 1" }).click();
  await chooseItem(page, SLOT_ID, name);
}

test("an item's shortDescription shows in its row's stat summary", async ({
  page,
}) => {
  const name = "ZZZ Test Short Description Item";
  await createAndEquipDescribedItem(page, name);
  await expect(slotRow(page, SLOT_ID)).toContainText(SHORT_DESCRIPTION);
});

test("an item's longDescription shows on its hover card", async ({ page }) => {
  const name = "ZZZ Test Long Description Item";
  await createAndEquipDescribedItem(page, name);
  await slotRow(page, SLOT_ID).hover();

  const card = page.locator(".fixed.z-40");
  await expect(card.getByTestId("item-card-name")).toHaveText(name);
  await expect(card).toContainText(LONG_DESCRIPTION);
});

test("an item's short/long description round-trip through the item editor", async ({
  page,
}) => {
  const uniqueName = "ZZZ Test Description Roundtrip Item";

  await openBuilder(page);
  await addLayer(page);
  await layerRow(page, "Layer 1").locator(".nav-name").click();
  await page.getByTestId("new-item").click();
  await page.getByTestId("item-name-input").fill(uniqueName);
  await page.getByTestId("item-filter-input").fill("gear_head");
  await page.getByTestId("add-item-description").click();
  await page
    .getByTestId("item-short-description-input")
    .fill(SHORT_DESCRIPTION);
  await page.getByTestId("item-long-description-input").fill(LONG_DESCRIPTION);
  await page.getByRole("button", { name: "Save item" }).click();

  // Re-open the saved item -- description already has values, so the fields show open on
  // their own, no need to click "+" again -- and confirm both carried through.
  await page.locator(".editor-search").fill(uniqueName);
  await page.locator(".editor-row", { hasText: uniqueName }).click();
  await expect(page.getByTestId("item-short-description-input")).toHaveValue(
    SHORT_DESCRIPTION,
  );
  await expect(page.getByTestId("item-long-description-input")).toHaveValue(
    LONG_DESCRIPTION,
  );
});
