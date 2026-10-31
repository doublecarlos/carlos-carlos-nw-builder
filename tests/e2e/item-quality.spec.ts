// End-to-end coverage for item qualities: the picker and hover card tint a quality item's name,
// and the item form saves a chosen quality.
import { test, expect, type Page } from "@playwright/test";
import {
  chooseCombo,
  chooseItem,
  hoverForCard,
  openBuilder,
  pickerInput,
  setItemFilter,
  slotRow,
} from "./support/app";
import { addLayer, layerRow } from "./support/nav";
import { statCard, statCardClose, statInfoButton } from "./support/stats";
import { importTestCatalog } from "./support/testCatalog";

const SLOT = "enchantments.offense1";
const CELESTIAL = "Test Celestial Enchantment";
const MYTHIC_HEAD = "Test Mythic Head";
const CATALOG_NAME = "Test qualities";

/** Imports one celestial enchantment and one mythic head with a stat to trace. */
async function importQualityItems(page: Page) {
  await importTestCatalog(page, {
    name: CATALOG_NAME,
    items: [
      {
        id: "test-celestial-enchantment",
        name: CELESTIAL,
        filter: "enchantment_offense",
        quality: "celestial",
      },
      {
        id: "test-mythic-head",
        name: MYTHIC_HEAD,
        filter: "gear_head",
        quality: "mythic",
        strike: 1000,
      },
    ],
  });
}

test("a quality item is tinted in the menu, the closed picker and the card", async ({
  page,
}) => {
  await openBuilder(page);
  await importQualityItems(page);
  const row = slotRow(page, SLOT);
  const input = pickerInput(row);

  await input.click();
  await input.fill(CELESTIAL);
  await expect(
    row
      .getByTestId("picker-option-name")
      .filter({ hasText: CELESTIAL })
      .first(),
  ).toHaveAttribute("data-quality", "celestial");

  await chooseItem(page, SLOT, CELESTIAL);
  await expect(input).toHaveAttribute("style", /--quality-celestial/);

  await hoverForCard(page, input);
  await expect(page.getByTestId("item-card-name")).toHaveAttribute(
    "data-quality",
    "celestial",
  );
});

test("the item form saves a quality", async ({ page }) => {
  const name = "ZZZ Test Quality Item";
  await openBuilder(page);
  await addLayer(page);
  await layerRow(page, "Layer 1").locator(".nav-name").click();
  await page.getByTestId("new-item").click();
  await page.getByTestId("item-name-input").fill(name);
  await setItemFilter(page, "gear_head");

  await chooseCombo(page.getByTestId("item-quality"), "Mythic");
  await page.getByRole("button", { name: "Save item" }).click();

  await page.locator(".editor-search").fill(name);
  await page.locator(".editor-row", { hasText: name }).click();
  await expect(
    page.getByTestId("item-quality").getByTestId("picker-input"),
  ).toHaveValue("Mythic");
});

test("a stat source line is tinted by its item, and card stats are not", async ({
  page,
}) => {
  await openBuilder(page);
  await importQualityItems(page);
  await chooseItem(page, "gear.head", MYTHIC_HEAD);

  await statInfoButton(page, "strike").click();
  const line = statCard(page)
    .getByTestId("stat-card-row")
    .filter({ hasText: MYTHIC_HEAD })
    .locator("span")
    .first();
  await expect(line).toHaveAttribute("style", /--quality-mythic/);
  await statCardClose(page).click();

  // The card sets a tone for its frame; its plain stat labels must not inherit it.
  await hoverForCard(page, pickerInput(slotRow(page, "gear.head")));
  const card = page.getByTestId("item-card");
  const name = await card
    .getByTestId("item-card-name")
    // eslint-disable-next-line no-restricted-syntax
    .evaluate((el) => getComputedStyle(el).color);
  const label = await card
    .getByTestId("stat-row")
    .first()
    .locator("span")
    .first()
    // eslint-disable-next-line no-restricted-syntax
    .evaluate((el) => getComputedStyle(el).color);
  expect(label).not.toBe(name);
});

test("a compare note tints the other build's item", async ({ page }) => {
  await openBuilder(page);
  await importQualityItems(page);
  await chooseItem(page, "gear.head", MYTHIC_HEAD);
  await page.getByTestId("nav-add-build").click();
  await chooseCombo(page.locator(".compare-select"), CATALOG_NAME);
  await page.getByRole("checkbox", { name: "Highlight changes" }).check();

  await expect(
    slotRow(page, "gear.head").getByTestId("compare-choice"),
  ).toHaveAttribute("style", /--quality-mythic/);
});

test("the layer editor's item list tints item names", async ({ page }) => {
  await openBuilder(page);
  await importQualityItems(page);
  await layerRow(page, `${CATALOG_NAME} (imported)`)
    .locator(".nav-name")
    .click();
  await page.locator(".editor-search").fill(MYTHIC_HEAD);
  await expect(
    page
      .locator(".editor-row", { hasText: MYTHIC_HEAD })
      .locator(".editor-row-name"),
  ).toHaveAttribute("style", /--quality-mythic/);
});
