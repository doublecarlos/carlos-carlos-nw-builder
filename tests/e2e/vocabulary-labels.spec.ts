// Labels from data/vocabulary.json in the item form's pickers: a labeled filter or tag reads
// by its label with the id under it, and is found by either.
import { test, expect, type Page } from "@playwright/test";
import { importText, confirmImport, openBuilder } from "./support/app";
import { layerRow } from "./support/nav";
import { shippedLabeledTag } from "./support/shippedData";

const FILTER = "test_trinket";
const FILTER_LABEL = "Test Trinket Label";

/** Imports a layer declaring a labeled test filter and one item in it, then opens the layer. */
async function openLabeledLayer(page: Page) {
  await openBuilder(page);
  await importText(
    page,
    JSON.stringify({
      name: "Test labels",
      choices: {},
      catalog: {
        items: {
          "test-trinket": {
            id: "test-trinket",
            name: "Test Trinket",
            filter: FILTER,
          },
        },
        bonuses: {},
        sectionPresets: {},
        filters: { [FILTER]: { id: FILTER, label: FILTER_LABEL } },
      },
    }),
  );
  await confirmImport(page);
  await layerRow(page, "Test labels (imported)").locator(".nav-name").click();
}

test("the item form's filter picker finds a labeled filter by its label", async ({
  page,
}) => {
  await openLabeledLayer(page);
  await page.getByTestId("new-item").click();

  const input = page.getByTestId("item-filter-input");
  await input.fill("Trinket Label");
  const row = page.getByRole("option", { name: FILTER_LABEL });
  await expect(row.getByTestId("option-row-id")).toHaveText(FILTER);

  // Choosing the row writes the id, not the label.
  await row.click();
  await expect(input).toHaveValue(FILTER);

  // So does typing the label in full and leaving the field.
  await input.fill(FILTER_LABEL);
  await input.blur();
  await expect(input).toHaveValue(FILTER);
});

test("the Filters tab lists a labeled filter by its label", async ({
  page,
}) => {
  await openLabeledLayer(page);
  await page.getByTestId("tab-filters").click();
  await page.locator(".editor-search").fill(FILTER_LABEL);

  const row = page.locator(".editor-row", { hasText: FILTER_LABEL });
  await expect(row.getByTestId("option-row-id")).toHaveText(FILTER);
});

test("the item form's tag picker finds a labeled tag by label and by id", async ({
  page,
}) => {
  const tag = shippedLabeledTag();
  await openLabeledLayer(page);
  await page.getByTestId("new-item").click();

  const field = page.getByTestId("item-tags-input");
  const query = field.getByTestId("token-query");
  const row = page.getByRole("option").filter({
    has: page.getByTestId("option-row-id").getByText(tag.id, { exact: true }),
  });
  await query.fill(tag.id);
  await expect(row).toContainText(tag.label);

  // Typing the label exactly picks that tag rather than coining a new one.
  await query.fill(tag.label);
  await expect(row).toBeVisible();
  await expect(page.getByRole("option", { name: /new$/ })).toHaveCount(0);
  await query.press("Enter");
  await expect(field).toContainText(tag.label);
});
