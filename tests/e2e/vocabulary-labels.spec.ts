// Labels from data/vocabulary.json in the editor's pickers: a labeled filter or tag reads by
// its label with the id under it, and is found by either.
import { test, expect, type Page } from "@playwright/test";
import {
  importText,
  confirmImport,
  openBuilder,
  pickerMenu,
} from "./support/app";
import { layerRow } from "./support/nav";
import { shippedLabeledTag } from "./support/shippedData";

const FILTER = "test_trinket";
const FILTER_LABEL = "Test Trinket Label";
const TAG = "test:charm";
const TAG_LABEL = "Test Charm Label";

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
        tags: { [TAG]: { id: TAG, label: TAG_LABEL } },
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

test("the Vocabulary tab lists a labeled filter by its label", async ({
  page,
}) => {
  await openLabeledLayer(page);
  await page.getByTestId("tab-vocabulary").click();
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

/** Starts a new bonus in the labeled layer with one grant gated by an `equipped` leaf. */
async function openEquippedCondition(page: Page) {
  await openLabeledLayer(page);
  await page.getByRole("button", { name: /Bonuses \d+/ }).click();
  await page.getByTestId("new-bonus").click();
  await page.getByLabel("Add grant").click();
  await page.getByLabel("Add condition").click();
  const grant = page.getByTestId("bonus-grant-row").first();
  const condition = page.getByTestId("condition-row").first();
  await condition.getByTestId("picker-input").first().click();
  await pickerMenu(condition).getByText("equipped", { exact: true }).click();
  return { grant, input: condition.getByTestId("condition-tag") };
}

// A condition's tag is matched by id, so the picker has to save the id whichever way the tag was
// found.
test("an equipped condition's tag picker finds a labeled tag by label and by id and saves the id", async ({
  page,
}) => {
  const { grant, input } = await openEquippedCondition(page);
  const row = page.getByRole("option", { name: TAG_LABEL });

  await input.fill("Charm Label");
  await expect(row.getByTestId("option-row-id")).toHaveText(TAG);
  await row.click();
  await expect(input).toHaveValue(TAG);

  await input.fill(TAG);
  await expect(row).toBeVisible();
  await input.press("Enter");
  await expect(input).toHaveValue(TAG);

  await grant.getByLabel("Edit as JSON").click();
  const json = await grant.locator("textarea").inputValue();
  expect(JSON.parse(json).when).toEqual({ equipped: { tag: TAG } });
});

// A condition may test a tag before any item carries it, so free text stays accepted.
test("an equipped condition's tag picker keeps a tag typed by hand", async ({
  page,
}) => {
  const { input } = await openEquippedCondition(page);
  await input.fill("test:not-yet-carried");
  await expect(page.getByRole("option", { name: /new$/ })).toBeVisible();
  await input.blur();
  await expect(input).toHaveValue("test:not-yet-carried");
});

// The equipped leaf names a tag or an exact item, so a tag picked by mistake has to come out.
test("an equipped condition's tag picker clears through its empty row", async ({
  page,
}) => {
  const { grant, input } = await openEquippedCondition(page);
  await input.fill(TAG);
  await input.press("Enter");
  await expect(input).toHaveValue(TAG);

  // The empty row clears; it is not a new value to coin.
  await input.click();
  const empty = page.getByRole("option", { name: "- empty -", exact: true });
  await expect(empty).toBeVisible();
  await expect(page.getByRole("option", { name: /new$/ })).toHaveCount(0);
  await empty.click();
  await expect(input).toHaveValue("");

  await grant.getByLabel("Edit as JSON").click();
  const json = await grant.locator("textarea").inputValue();
  expect(JSON.parse(json).when).toBeUndefined();
});

// Tabbing through a filled picker on the way to the next field must not swap its value for the
// first listed row.
test("tabbing through a filled tag picker keeps its tag", async ({ page }) => {
  const { input } = await openEquippedCondition(page);
  await input.fill("test:not-yet-carried");
  await input.press("Enter");
  await input.blur();

  await input.focus();
  await expect(page.getByRole("listbox")).toBeVisible();
  await input.press("Tab");
  await expect(input).toHaveValue("test:not-yet-carried");
});

// Opening a filled picker blanks its text to browse every row, so the current pick stays in view
// as the placeholder, shown as the closed field shows it.
test("an open tag picker shows the current tag as its placeholder", async ({
  page,
}) => {
  const { input } = await openEquippedCondition(page);
  await input.fill(TAG);
  await input.press("Enter");
  await input.blur();

  await input.focus();
  await expect(input).toHaveValue("");
  await expect(input).toHaveAttribute("placeholder", TAG);
});
