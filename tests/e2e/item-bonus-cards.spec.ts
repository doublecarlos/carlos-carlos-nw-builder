// The item editor's attached bonus cards: which reopen expanded, folding a card from its
// header row, and the expand/collapse all pair.
import { test, expect, type Page } from "@playwright/test";
import { openBuilder, setItemFilter } from "./support/app";
import { addLayer, layerRow } from "./support/nav";

const UNIQUE_ITEM = "ZZZ Test Card Item";
const UNIQUE_BONUS = "ZZZ Test Card Bonus";
const SECOND_BONUS = "ZZZ Test Card Bonus Two";

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

/** Creates a brand-new item draft with one freshly-saved private bonus attached, leaving the
 *  item form open (item itself still unsaved) for further edits. The just-saved card stays
 *  open. */
async function openItemFormWithAttachedBonus(page: Page) {
  await openBuilder(page);
  await addLayer(page);
  await layerRow(page, "Layer 1").locator(".nav-name").click();
  await page.getByTestId("new-item").click();
  await page.getByTestId("item-name-input").fill(UNIQUE_ITEM);
  await setItemFilter(page, "gear_head");
  await addAndSaveBonus(page, UNIQUE_BONUS);
}

test("two attached bonuses reopen collapsed, and expand/collapse all fold them together", async ({
  page,
}) => {
  await openItemFormWithAttachedBonus(page);
  await addAndSaveBonus(page, SECOND_BONUS);
  await page.getByRole("button", { name: "Save item" }).click();

  await page.locator(".editor-search").fill(UNIQUE_ITEM);
  await page.locator(".editor-row", { hasText: UNIQUE_ITEM }).click();
  const cards = page.getByTestId("bonus-card");
  await expect(cards).toHaveCount(2);
  await expect(cards.nth(0)).toHaveAttribute("data-expanded", "false");
  await expect(cards.nth(1)).toHaveAttribute("data-expanded", "false");

  const expandAll = page.getByTestId("bonus-expand-all");
  const collapseAll = page.getByTestId("bonus-collapse-all");
  await expect(expandAll).toBeEnabled();
  await expect(collapseAll).toBeDisabled();

  await expandAll.click();
  await expect(cards.nth(0)).toHaveAttribute("data-expanded", "true");
  await expect(cards.nth(1)).toHaveAttribute("data-expanded", "true");
  await expect(expandAll).toBeDisabled();
  await expect(collapseAll).toBeEnabled();

  // One card folded by hand puts both buttons back in play.
  await cards.nth(0).getByTestId("bonus-card-toggle").click();
  await expect(expandAll).toBeEnabled();
  await expect(collapseAll).toBeEnabled();

  await collapseAll.click();
  await expect(cards.nth(0)).toHaveAttribute("data-expanded", "false");
  await expect(cards.nth(1)).toHaveAttribute("data-expanded", "false");
  await expect(collapseAll).toBeDisabled();
});

test("a card folds from anywhere on its header row except its own controls", async ({
  page,
}) => {
  await openItemFormWithAttachedBonus(page);
  const card = page.getByTestId("bonus-card").first();
  const title = card.getByTestId("form-bar-title");
  await expect(card).toHaveAttribute("data-expanded", "true");

  await title.click();
  await expect(card).toHaveAttribute("data-expanded", "false");
  await title.click();
  await expect(card).toHaveAttribute("data-expanded", "true");

  // A control on the row does its own job and leaves the fold alone.
  await card.getByTestId("duplicate-bonus").click();
  await expect(page.getByTestId("bonus-card")).toHaveCount(2);
  await expect(card).toHaveAttribute("data-expanded", "true");
  await page.getByTestId("bonus-card").last().getByLabel("Detach").click();
  await expect(page.getByTestId("bonus-card")).toHaveCount(1);
  await expect(card).toHaveAttribute("data-expanded", "true");
});

test("the empty note sits above the add row, which follows the cards", async ({
  page,
}) => {
  await openBuilder(page);
  await addLayer(page);
  await layerRow(page, "Layer 1").locator(".nav-name").click();
  await page.getByTestId("new-item").click();
  await page.getByTestId("item-name-input").fill(UNIQUE_ITEM);
  await setItemFilter(page, "gear_head");

  const addRow = page.getByTestId("bonus-add-row");
  const empty = page.getByTestId("bonus-empty");
  await expect(empty).toHaveText("This item has no bonuses.");
  await expect(addRow.getByLabel("Add bonus")).toBeVisible();
  const emptyBox = await empty.boundingBox();
  const emptyRowBox = await addRow.boundingBox();
  expect(emptyRowBox!.y).toBeGreaterThan(emptyBox!.y + emptyBox!.height - 1);

  await addAndSaveBonus(page, UNIQUE_BONUS);
  await expect(empty).toBeHidden();
  const cardBox = await page.getByTestId("bonus-card").last().boundingBox();
  const rowBox = await addRow.boundingBox();
  expect(rowBox!.y).toBeGreaterThan(cardBox!.y + cardBox!.height - 1);

  // The fold pair only appears once there is more than one card.
  await expect(page.getByTestId("bonus-expand-all")).toHaveCount(0);
  await addAndSaveBonus(page, SECOND_BONUS);
  await expect(page.getByTestId("bonus-expand-all")).toBeVisible();
});
