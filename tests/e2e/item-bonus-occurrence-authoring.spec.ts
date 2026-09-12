// End-to-end coverage for authoring a `BonusOccurrenceConfig` attachment in the item editor.
// Each attached bonus card opens on a one-line plain state ("Counts ×1 on this item") whose
// "Customize" link reveals three modes: Fixed (a plain id at count 1), Toggle (a 0..1
// checkbox) and Range (typed min/max/default); "Use ×1" goes back to plain. The section only
// appears once the bonus itself has a real id; a brand-new, not-yet-saved bonus is still a
// "pending" slot with nothing to attach a config to. Also covers which cards reopen expanded,
// folding a card from its header row, the expand/collapse all pair, and the optional `label`
// override.
import { test, expect, type Locator, type Page } from "@playwright/test";
import { openBuilder, setItemFilter } from "./support/app";
import { addLayer, layerRow } from "./support/nav";

const UNIQUE_ITEM = "ZZZ Test Occurrence Item";
const UNIQUE_BONUS = "ZZZ Test Occurrence Bonus";
const SECOND_BONUS = "ZZZ Test Occurrence Bonus Two";

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
 *  open, so its occurrence section is on screen in its plain state. */
async function openItemFormWithAttachedBonus(page: Page) {
  await openBuilder(page);
  await addLayer(page);
  await layerRow(page, "Layer 1").locator(".nav-name").click();
  await page.getByTestId("new-item").click();
  await page.getByTestId("item-name-input").fill(UNIQUE_ITEM);
  await setItemFilter(page, "gear_head");
  await addAndSaveBonus(page, UNIQUE_BONUS);
}

/** Opens the plain attachment's full mode UI. */
async function customize(page: Page): Promise<Locator> {
  const section = page.getByTestId("occurrence-section");
  await section.getByTestId("occurrence-customize").click();
  await expect(section.getByTestId("occurrence-mode")).toBeVisible();
  return section;
}

/** Reopens the saved item; its one bonus card reopens expanded. */
async function reopenItem(page: Page): Promise<Locator> {
  await page.locator(".editor-search").fill(UNIQUE_ITEM);
  await page.locator(".editor-row", { hasText: UNIQUE_ITEM }).click();
  const card = page.getByTestId("bonus-card");
  await expect(card).toHaveAttribute("data-expanded", "true");
  return card;
}

/** The item's `bonuses` entries as the layer's own overlay JSON holds them. Leaves the export
 *  window open; callers dismiss it. */
async function savedBonusesOf(page: Page): Promise<unknown[]> {
  await page.getByTestId("layer-export-toggle").click();
  const text = await page
    .getByTestId("layer-export")
    .locator("textarea")
    .inputValue();
  const overlay = JSON.parse(text) as {
    items: Record<string, { name: string; bonuses?: unknown[] }>;
  };
  const item = Object.values(overlay.items).find(
    (entry) => entry.name === UNIQUE_ITEM,
  );
  return item?.bonuses ?? [];
}

test("a freshly attached bonus is one plain line, and Customize opens Fixed ×1 without changing it", async ({
  page,
}) => {
  await openItemFormWithAttachedBonus(page);

  const section = page.getByTestId("occurrence-section");
  await expect(section.getByTestId("occurrence-plain")).toHaveText(
    "Counts ×1 on this item · Customize",
  );
  await expect(section.getByTestId("occurrence-mode")).toBeHidden();
  await expect(section.getByTestId("occurrence-count-input")).toBeHidden();
  await expect(page.getByTestId("occurrence-chip")).toHaveText("×1");

  await customize(page);
  await expect(section.getByTestId("occurrence-plain")).toBeHidden();
  await expect(section.getByTestId("occurrence-count-input")).toHaveValue("1");
  await expect(section.getByTestId("occurrence-label-input")).toBeHidden();
  await expect(section.getByTestId("occurrence-preview")).toBeHidden();
  await expect(page.getByTestId("occurrence-chip")).toHaveText("×1");

  // Opening the fields is not an edit: the attachment still saves as a bare id.
  await page.getByRole("button", { name: "Save item" }).click();
  expect(await savedBonusesOf(page)).toEqual([expect.any(String)]);
});

test("switching Fixed → Toggle → Range shows each mode's own fields", async ({
  page,
}) => {
  await openItemFormWithAttachedBonus(page);
  const section = await customize(page);

  await section.getByTestId("occurrence-mode-toggle").click();
  await expect(section.getByTestId("occurrence-count-input")).toBeHidden();
  await expect(section.getByTestId("occurrence-default-toggle")).toBeVisible();
  await expect(section.getByTestId("occurrence-label-input")).toBeVisible();
  // A plain attachment is always on, so the toggle starts on to keep that meaning.
  await expect(
    section.getByTestId("occurrence-default-toggle").locator("input"),
  ).toBeChecked();
  await expect(
    section.getByTestId("occurrence-preview").locator("input[type=checkbox]"),
  ).toBeVisible();
  await expect(page.getByTestId("occurrence-chip")).toHaveText("toggle");

  await section.getByTestId("occurrence-mode-range").click();
  await expect(section.getByTestId("occurrence-default-toggle")).toBeHidden();
  await expect(section.getByTestId("occurrence-min-input")).toHaveValue("0");
  await expect(section.getByTestId("occurrence-max-input")).toHaveValue("1");
  await expect(section.getByTestId("occurrence-default-input")).toHaveValue(
    "1",
  );
  await section.getByTestId("occurrence-max-input").fill("5");
  await expect(
    section.getByTestId("occurrence-preview").locator("input[type=number]"),
  ).toBeVisible();
  await expect(page.getByTestId("occurrence-chip")).toHaveText("0–5");

  // Typing a range whose bounds meet does not yank the fields away as a Fixed count.
  await section.getByTestId("occurrence-min-input").fill("5");
  await expect(section.getByTestId("occurrence-min-input")).toBeVisible();
  await expect(section.getByTestId("occurrence-count-input")).toBeHidden();
});

test("a saved range config, including its label, survives a save and reopen", async ({
  page,
}) => {
  await openItemFormWithAttachedBonus(page);

  const section = await customize(page);
  await section.getByTestId("occurrence-mode-range").click();
  await section.getByTestId("occurrence-min-input").fill("0");
  await section.getByTestId("occurrence-max-input").fill("5");
  await section.getByTestId("occurrence-default-input").fill("2");
  await section.getByTestId("occurrence-label-input").fill("Stacks");

  await page.getByRole("button", { name: "Save item" }).click();

  // A configured attachment reopens straight into its fields, with nothing to customize.
  const card = await reopenItem(page);
  const reopened = card.getByTestId("occurrence-section");
  await expect(reopened.getByTestId("occurrence-customize")).toBeHidden();
  await expect(reopened.getByTestId("occurrence-min-input")).toHaveValue("0");
  await expect(reopened.getByTestId("occurrence-max-input")).toHaveValue("5");
  await expect(reopened.getByTestId("occurrence-default-input")).toHaveValue(
    "2",
  );
  await expect(reopened.getByTestId("occurrence-label-input")).toHaveValue(
    "Stacks",
  );
  await expect(card.getByTestId("occurrence-chip")).toHaveText("0–5");
});

test("a Fixed ×1 config saves as a plain attachment, a Fixed ×3 as a config", async ({
  page,
}) => {
  await openItemFormWithAttachedBonus(page);
  const section = await customize(page);

  // Leave Range with bounds that mean "always once", the same thing a bare id says.
  await section.getByTestId("occurrence-mode-range").click();
  await section.getByTestId("occurrence-max-input").fill("5");
  await section.getByTestId("occurrence-mode-fixed").click();
  await expect(section.getByTestId("occurrence-count-input")).toHaveValue("1");

  await page.getByRole("button", { name: "Save item" }).click();
  expect(await savedBonusesOf(page)).toEqual([expect.any(String)]);
  await page.keyboard.press("Escape");

  // The item is saved now, so this edit lands through the live-edit auto-save instead.
  const card = await reopenItem(page);
  await card.getByTestId("occurrence-customize").click();
  await card.getByTestId("occurrence-count-input").fill("3");
  await expect(card.getByTestId("occurrence-chip")).toHaveText("×3");
  // Past the 700ms auto-save debounce.
  await page.waitForTimeout(1500);
  expect(await savedBonusesOf(page)).toEqual([
    { bonus: expect.any(String), min: 3, max: 3, default: 3 },
  ]);
});

test("Use ×1 drops a Range config back to a plain attachment", async ({
  page,
}) => {
  await openItemFormWithAttachedBonus(page);
  const section = await customize(page);

  // Range enters from the plain ×1, so only the top bound moves.
  await section.getByTestId("occurrence-mode-range").click();
  await section.getByTestId("occurrence-max-input").fill("5");
  await expect(page.getByTestId("occurrence-chip")).toHaveText("1–5");

  await section.getByTestId("occurrence-reset").click();
  await expect(section.getByTestId("occurrence-plain")).toBeVisible();
  await expect(section.getByTestId("occurrence-mode")).toBeHidden();
  await expect(page.getByTestId("occurrence-chip")).toHaveText("×1");

  await page.getByRole("button", { name: "Save item" }).click();
  expect(await savedBonusesOf(page)).toEqual([expect.any(String)]);
});

test("an empty label is not persisted as a saved field", async ({ page }) => {
  await openItemFormWithAttachedBonus(page);

  const section = await customize(page);
  await section.getByTestId("occurrence-mode-toggle").click();
  await section.getByTestId("occurrence-default-toggle").click();

  await page.getByRole("button", { name: "Save item" }).click();
  expect(await savedBonusesOf(page)).toEqual([
    { bonus: expect.any(String), min: 0, max: 1, default: 0 },
  ]);
});

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
