// End-to-end coverage for reordering an item's attached bonuses. Only attached bonuses are
// reorderable (a pending, not-yet-saved one has no id to move), so this drives the shared
// useDragHandle/useDropList wiring plus the up/down arrow buttons on the same list.
import { test, expect, type Page } from "@playwright/test";
import { openBuilder, setItemFilter } from "./support/app";
import { addLayer, layerRow } from "./support/nav";
import { dragOnto } from "./support/dragDrop";

const NAMES = ["Alpha Bonus", "Beta Bonus", "Gamma Bonus"];

/** Adds a brand-new private bonus to the open item form and saves it, which attaches it. */
async function addAndSaveBonus(page: Page, name: string) {
  await page.getByLabel("Add bonus").click();
  await page
    .getByTestId("bonus-card")
    .last()
    .getByTestId("bonus-name-input")
    .fill(name);
  await page.getByRole("button", { name: "Save bonus" }).click();
}

/** Opens a fresh unsaved item carrying three attached, named bonuses. */
async function openItemWithBonuses(page: Page) {
  await openBuilder(page);
  await addLayer(page);
  await layerRow(page, "Layer 1").locator(".nav-name").click();
  await page.getByTestId("new-item").click();
  await page.getByTestId("item-name-input").fill("ZZZ Reorder Item");
  await setItemFilter(page, "gear_head");
  for (const name of NAMES) await addAndSaveBonus(page, name);
}

/** The attached bonus titles, in rendered order. */
function bonusTitles(page: Page) {
  return page.getByTestId("bonus-card").getByTestId("form-bar-title");
}

test("dragging an attached bonus onto another reorders the item's bonuses", async ({
  page,
}) => {
  await openItemWithBonuses(page);
  await expect(bonusTitles(page)).toHaveText(NAMES);

  const cards = page.getByTestId("bonus-card");
  // Drag the first bonus after the third.
  await dragOnto(
    cards.nth(0).getByTestId("bonus-drag-handle"),
    cards.nth(2),
    "after",
  );

  await expect(bonusTitles(page)).toHaveText([
    "Beta Bonus",
    "Gamma Bonus",
    "Alpha Bonus",
  ]);
});

test("the move up/down buttons reorder attached bonuses", async ({ page }) => {
  await openItemWithBonuses(page);

  const cards = page.getByTestId("bonus-card");
  await expect(cards.nth(0).getByTestId("bonus-move-up")).toBeDisabled();
  await expect(cards.nth(2).getByTestId("bonus-move-down")).toBeDisabled();

  await cards.nth(0).getByTestId("bonus-move-down").click();
  await expect(bonusTitles(page)).toHaveText([
    "Beta Bonus",
    "Alpha Bonus",
    "Gamma Bonus",
  ]);

  await cards.nth(1).getByTestId("bonus-move-up").click();
  await expect(bonusTitles(page)).toHaveText(NAMES);
});

test("no drag handle is offered for a pending, not-yet-saved bonus", async ({
  page,
}) => {
  await openBuilder(page);
  await addLayer(page);
  await layerRow(page, "Layer 1").locator(".nav-name").click();
  await page.getByTestId("new-item").click();

  await page.getByLabel("Add bonus").click();
  await expect(page.getByTestId("bonus-card")).toHaveCount(1);
  await expect(page.getByTestId("bonus-drag-handle")).toHaveCount(0);
  await expect(page.getByTestId("bonus-move-up")).toHaveCount(0);
});
