// Bonus deletion: an item's embedded bonus offers Detach only, while deleting the standalone
// bonus confirms, offers to unlink it from its items, and lint flags a bonus nothing attaches.
import { test, expect, type Page } from "@playwright/test";
import { openBuilder, setItemFilter } from "./support/app";
import { addLayer, layerRow } from "./support/nav";

const ITEM = "ZZZ Bonus Delete Item";
const BONUS = "ZZZ Bonus Delete Bonus";

async function openLayer(page: Page) {
  await openBuilder(page);
  await addLayer(page);
  await layerRow(page, "Layer 1").locator(".nav-name").click();
}

async function createItemWithBonus(page: Page) {
  await page.getByTestId("new-item").click();
  await page.getByTestId("item-name-input").fill(ITEM);
  await setItemFilter(page, "gear_head");
  await page.getByRole("button", { name: "Save item" }).click();

  await page.getByRole("button", { name: "Add bonus" }).click();
  const card = page.getByTestId("bonus-card");
  await card.getByTestId("bonus-name-input").fill(BONUS);
  await card.getByRole("button", { name: "Save bonus" }).click();
  await expect(card.getByTestId("duplicate-bonus")).toBeVisible();
}

test("an item's embedded bonus offers Detach, never Delete", async ({
  page,
}) => {
  await openLayer(page);
  await createItemWithBonus(page);

  const card = page.getByTestId("bonus-card");
  await expect(card.getByLabel("Detach")).toBeVisible();
  await expect(card.getByLabel("Delete")).toHaveCount(0);
});

test("deleting a standalone bonus unlinks it from its items by default", async ({
  page,
}) => {
  await openLayer(page);
  await createItemWithBonus(page);

  await page.getByRole("button", { name: /Bonuses \d+/ }).click();
  await page.locator(".editor-search").fill(BONUS);
  await page.locator(".editor-row", { hasText: BONUS }).first().click();

  await page.getByTestId("form-bar").first().getByLabel("Delete").click();
  await expect(page.getByTestId("confirm-dialog")).toBeVisible();
  const checkbox = page.getByTestId("confirm-checkbox").locator("input");
  await expect(checkbox).toBeChecked();
  await expect(page.getByTestId("confirm-checkbox")).toContainText(
    "Also unlink from 1 item",
  );

  await page.getByTestId("confirm-accept").click();
  await expect(page.locator(".editor-row", { hasText: BONUS })).toHaveCount(0);

  // The item no longer attaches it, so its Bonuses section is empty.
  await page.getByRole("button", { name: /Items \d+/ }).click();
  await page.locator(".editor-search").fill(ITEM);
  await page.locator(".editor-row", { hasText: ITEM }).first().click();
  await expect(page.getByTestId("bonus-card")).toHaveCount(0);
  await expect(page.getByText("This item has no bonuses.")).toBeVisible();
});

test("unchecking the unlink option leaves a dangling reference lint can see", async ({
  page,
}) => {
  await openLayer(page);
  await createItemWithBonus(page);

  await page.getByRole("button", { name: /Bonuses \d+/ }).click();
  await page.locator(".editor-search").fill(BONUS);
  await page.locator(".editor-row", { hasText: BONUS }).first().click();

  await page.getByTestId("form-bar").first().getByLabel("Delete").click();
  await page.getByTestId("confirm-checkbox").locator("input").uncheck();
  await page.getByTestId("confirm-accept").click();

  await expect(page.getByTestId("validation-drawer")).toContainText(
    "has no definition",
  );
});

test("a bonus attached to no item is linted", async ({ page }) => {
  await openLayer(page);
  await page.getByRole("button", { name: /Bonuses \d+/ }).click();
  await page.getByTestId("new-bonus").click();
  await page.getByTestId("bonus-name-input").fill(BONUS);
  await page.getByRole("button", { name: "Save bonus" }).click();

  await expect(page.getByTestId("validation-drawer")).toContainText(
    "not attached to any item",
  );
});
