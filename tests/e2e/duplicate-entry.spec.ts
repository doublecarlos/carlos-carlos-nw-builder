// End-to-end coverage for "Duplicate" on items and bonus sets (issue #68): it opens an
// editable draft pre-filled from the selected entry, saved only on explicit confirmation --
// never overwrites the original, and Save mints a fresh id since the name is still taken.
import { test, expect } from "@playwright/test";
import { openBuilder } from "./support/app";
import { addLayer, layerRow } from "./support/nav";

const ITEM_NAME = "ZZZ Test Duplicate Item";
const SET_NAME = "ZZZ Test Duplicate Set";

test("duplicating an item opens a pre-filled draft that saves as a separate item", async ({
  page,
}) => {
  await openBuilder(page);
  await addLayer(page);
  await layerRow(page, "Layer 1").locator(".nav-name").click();

  // Create the original item.
  await page.getByTestId("new-item").click();
  await page.getByTestId("item-name-input").fill(ITEM_NAME);
  await page.getByTestId("item-filter-input").fill("gear_head");
  await page.getByRole("button", { name: "Save item" }).click();
  await expect(page.locator(".editor-row", { hasText: ITEM_NAME })).toHaveCount(
    1,
  );

  // Select it and duplicate.
  await page.locator(".editor-search").fill(ITEM_NAME);
  await page.locator(".editor-row", { hasText: ITEM_NAME }).click();
  await page.getByTestId("duplicate-item").click();

  // A brand-new draft, pre-filled from the original -- not yet saved, and the original is
  // still the only row in the list.
  await expect(page.getByTestId("item-name-input")).toHaveValue(ITEM_NAME);
  await expect(page.getByTestId("item-filter-input")).toHaveValue("gear_head");
  await expect(page.getByRole("button", { name: "Save item" })).toBeVisible();
  await expect(page.locator(".editor-row", { hasText: ITEM_NAME })).toHaveCount(
    1,
  );

  // Saving the draft as-is (same name) still mints a distinct id, so it lands as a second
  // entry rather than overwriting the original.
  await page.getByRole("button", { name: "Save item" }).click();
  await expect(page.locator(".editor-row", { hasText: ITEM_NAME })).toHaveCount(
    2,
  );
});

test("duplicating a bonus set opens a pre-filled draft that saves as a separate set", async ({
  page,
}) => {
  await openBuilder(page);
  await addLayer(page);
  await layerRow(page, "Layer 1").locator(".nav-name").click();
  await page.getByRole("button", { name: /Bonus sets \d+/ }).click();

  // Create the original set.
  await page.getByTestId("new-bonus-set").click();
  await page.getByTestId("bonus-set-name-input").fill(SET_NAME);
  await page.getByRole("button", { name: "Save bonus set" }).click();
  await expect(page.locator(".editor-row", { hasText: SET_NAME })).toHaveCount(
    1,
  );

  // Select it and duplicate.
  await page.locator(".editor-search").fill(SET_NAME);
  await page.locator(".editor-row", { hasText: SET_NAME }).click();
  await page.getByTestId("duplicate-bonus-set").click();

  await expect(page.getByTestId("bonus-set-name-input")).toHaveValue(SET_NAME);
  await expect(
    page.getByRole("button", { name: "Save bonus set" }),
  ).toBeVisible();
  await expect(page.locator(".editor-row", { hasText: SET_NAME })).toHaveCount(
    1,
  );

  await page.getByRole("button", { name: "Save bonus set" }).click();
  await expect(page.locator(".editor-row", { hasText: SET_NAME })).toHaveCount(
    2,
  );
});

test("Duplicate is not offered while creating a brand-new item", async ({
  page,
}) => {
  await openBuilder(page);
  await addLayer(page);
  await layerRow(page, "Layer 1").locator(".nav-name").click();

  await page.getByTestId("new-item").click();
  await expect(page.getByTestId("duplicate-item")).toBeHidden();
});
