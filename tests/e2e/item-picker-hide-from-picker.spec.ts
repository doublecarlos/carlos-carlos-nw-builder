// End-to-end coverage for a `Grant.problem`'s `hideFromPicker` flag: a candidate that would
// activate such a grant is left out of its slot's item picker dropdown entirely, not just
// flagged once picked (unlike a plain problem grant, which only shows its warning/error after
// the fact -- see problem-bonus-visibility.spec.ts). Builds a throwaway item + bonus set
// through the real layer editor UI rather than editing shipped game data, since the flag has
// no shipped example yet.
import { test, expect } from "@playwright/test";
import { openBuilder, slotRow, pickerInput } from "./support/app";
import { addLayer, layerRow } from "./support/nav";

const HIDDEN_ITEM = "ZZZ Test Hide From Picker Item";
const VISIBLE_ITEM = "ZZZ Test Plain Problem Item";

/** Creates a new item in a fresh layer with one always-active `problem` grant (no `when`,
 *  so it's active the moment the item exists) attached as its own bonus, optionally flagged
 *  `hideFromPicker`. Leaves the layer editor once saved. */
async function createItemWithProblemGrant(
  page: import("@playwright/test").Page,
  name: string,
  { hideFromPicker }: { hideFromPicker: boolean },
) {
  await page.getByTestId("new-item").click();
  await page.getByTestId("item-name-input").fill(name);
  await page.getByTestId("item-filter-input").fill("gear_head");

  await page.getByTitle("Add bonus").click();
  await page.getByTitle("Add grant").click();
  await page.getByRole("button", { name: "reports a problem" }).click();
  await page.getByTestId("problem-message").fill("Always active for this test");
  if (hideFromPicker) {
    await page.getByTestId("problem-hide-from-picker").click();
  }
  await page.getByRole("button", { name: "Save bonus set" }).click();
  await page.getByRole("button", { name: "Save item" }).click();
}

test("an item whose problem grant is flagged hideFromPicker is left out of its slot's dropdown, but a plain problem grant still shows the item", async ({
  page,
}) => {
  await openBuilder(page);
  await addLayer(page);
  await layerRow(page, "Layer 1").locator(".nav-name").click();

  await createItemWithProblemGrant(page, HIDDEN_ITEM, {
    hideFromPicker: true,
  });
  await createItemWithProblemGrant(page, VISIBLE_ITEM, {
    hideFromPicker: false,
  });

  // Back to the build.
  await page
    .getByTestId("library")
    .locator(".nav-row--build")
    .first()
    .locator(".nav-name")
    .click();
  await expect(page.getByTestId("builder-content")).toBeVisible();

  const row = slotRow(page, "gear.head");
  await row.scrollIntoViewIfNeeded();
  await pickerInput(row).click();

  const menu = row.getByTestId("picker-menu");
  await expect(menu.getByText(VISIBLE_ITEM, { exact: true })).toBeVisible();
  await expect(menu.getByText(HIDDEN_ITEM, { exact: true })).toHaveCount(0);
});
