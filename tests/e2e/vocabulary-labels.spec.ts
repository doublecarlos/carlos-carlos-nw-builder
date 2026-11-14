// Labels from data/vocabulary.json in the editor's pickers: a labeled filter or tag reads by
// its label with the id under it, and is found by either.
import { test, expect, type Page } from "@playwright/test";
import {
  importText,
  confirmImport,
  openBuilder,
  pickerMenu,
  comboBoxClear,
  comboBoxValueId,
  hoverForCard,
  slotRow,
  pickerAside,
  pickerInput,
} from "./support/app";
import { layerRow } from "./support/nav";
import { shippedLabeledTag } from "./support/shippedData";

const FILTER = "test_trinket";
const FILTER_LABEL = "Test Trinket Label";
const TAG = "test:charm";
const TAG_LABEL = "Test Charm Label";

/** A second labeled filter whose id sorts before `FILTER` and whose label contains its label. */
const LONGER_FILTER = "test_a_trinket";
const LONGER_FILTER_LABEL = `${FILTER_LABEL} plus`;

/** Imports a layer declaring a labeled test filter and one item in it, then opens the layer.
 *  `withLonger` also declares `LONGER_FILTER`. */
async function openLabeledLayer(page: Page, withLonger = false) {
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
        filters: {
          [FILTER]: { id: FILTER, label: FILTER_LABEL },
          ...(withLonger && {
            [LONGER_FILTER]: { id: LONGER_FILTER, label: LONGER_FILTER_LABEL },
          }),
        },
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

  // Choosing the row writes the id, which the closed field shows beside the label.
  await row.click();
  await expect(input).toHaveValue(FILTER_LABEL);
  await expect(comboBoxValueId(input)).toHaveText(FILTER);

  // So does typing the label in full and leaving the field.
  await input.fill(FILTER_LABEL);
  await input.blur();
  await expect(input).toHaveValue(FILTER_LABEL);
  await expect(comboBoxValueId(input)).toHaveText(FILTER);
});

// Enter on a typed exact label commits the option a blur would, not an earlier row whose text
// also matches.
test("Enter on a filter's exact label picks that filter over a longer match", async ({
  page,
}) => {
  await openLabeledLayer(page, true);
  await page.getByTestId("new-item").click();

  const input = page.getByTestId("item-filter-input");
  await input.fill(FILTER_LABEL);
  await expect(
    page.getByRole("option", { name: LONGER_FILTER_LABEL }),
  ).toBeVisible();
  await input.press("Enter");
  await expect(comboBoxValueId(input)).toHaveText(FILTER);
});

// Rows lead with the label, so the list reads in label order rather than id order.
test("the Vocabulary tab sorts categories by label", async ({ page }) => {
  await openLabeledLayer(page, true);
  await page.getByTestId("tab-vocabulary").click();
  await page.locator(".editor-search").fill(FILTER_LABEL);

  await expect(
    page.locator(".editor-row").getByTestId("option-row-id"),
  ).toHaveText([FILTER, LONGER_FILTER]);
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

// Declaring a tag in the Vocabulary tab and then tagging items with it is the usual order, so
// the item form offers a declared tag no item carries yet.
test("the item form's tag picker offers a declared tag no item carries", async ({
  page,
}) => {
  await openLabeledLayer(page);
  await page.getByTestId("new-item").click();

  const field = page.getByTestId("item-tags-input");
  const query = field.getByTestId("token-query");
  await query.fill(TAG_LABEL);
  await expect(page.getByRole("option", { name: /new$/ })).toHaveCount(0);
  await query.press("Enter");
  await expect(field.getByTestId("token-chip")).toHaveAttribute(
    "data-value",
    TAG,
  );
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
  await expect(input).toHaveValue(TAG_LABEL);
  await expect(comboBoxValueId(input)).toHaveText(TAG);

  await input.fill(TAG);
  await expect(row).toBeVisible();
  await input.press("Enter");
  await expect(input).toHaveValue(TAG_LABEL);

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
  // An unlabeled tag reads as its id alone, not the id twice.
  await expect(comboBoxValueId(input)).toHaveCount(0);
});

// The equipped leaf names a tag or an exact item, so a tag picked by mistake has to come out.
test("an equipped condition's tag picker clears through its empty row", async ({
  page,
}) => {
  const { grant, input } = await openEquippedCondition(page);
  await input.fill(TAG);
  await input.press("Enter");
  await expect(input).toHaveValue(TAG_LABEL);

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
  await expect(input).toHaveAttribute("placeholder", TAG_LABEL);
});

// The clear button is the pointer's way to empty the field without opening the list, and it
// adds no Tab stop to the condition row.
test("an equipped condition's tag picker clears with its clear button", async ({
  page,
}) => {
  const { grant, input } = await openEquippedCondition(page);
  const clear = comboBoxClear(input);
  await expect(clear).toHaveCount(0);

  await input.fill(TAG);
  await input.press("Enter");
  await input.blur();
  await expect(clear).toHaveAttribute("tabindex", "-1");
  await clear.click();
  await expect(input).toHaveValue("");
  await expect(clear).toHaveCount(0);
  await expect(page.getByRole("listbox")).toHaveCount(0);

  await grant.getByLabel("Edit as JSON").click();
  const json = await grant.locator("textarea").inputValue();
  expect(JSON.parse(json).when).toBeUndefined();
});

const RING_SLOT = "gear.ring1";

/** Equips a test ring whose `gear_ring` category this layer redefines as `ringFilter`. */
async function equipRingWithCategory(
  page: Page,
  ringFilter: { id: string; label?: string },
) {
  await openBuilder(page);
  await importText(
    page,
    JSON.stringify({
      name: "Test ring category",
      choices: { [RING_SLOT]: "test-category-ring" },
      catalog: {
        items: {
          "test-category-ring": {
            id: "test-category-ring",
            name: "Test Category Ring",
            filter: "gear_ring",
          },
        },
        bonuses: {},
        sectionPresets: {},
        filters: { gear_ring: ringFilter },
      },
    }),
  );
  await confirmImport(page);
  await expect(page.getByTestId("app-header")).toContainText(/imported/i);
}

// The hover card says what kind of item it is by the item's own category, so the same ring
// reads the same in any slot.
test("the item card names a labeled item category", async ({ page }) => {
  await equipRingWithCategory(page, {
    id: "gear_ring",
    label: "Test Ring Category",
  });
  await hoverForCard(page, slotRow(page, RING_SLOT).locator(".slot-label"));
  await expect(page.getByTestId("item-card-category")).toHaveText(
    "Test Ring Category",
  );
});

// The card reads the category off the item, so a picker's preview card names it too.
test("the item picker's preview card names a labeled item category", async ({
  page,
}) => {
  await equipRingWithCategory(page, {
    id: "gear_ring",
    label: "Test Ring Category",
  });
  const row = slotRow(page, RING_SLOT);
  await pickerInput(row).click();
  await pickerMenu(row)
    .getByTestId("picker-option")
    .filter({ hasText: "Test Category Ring" })
    .hover();
  const card = pickerAside(row).getByTestId("item-card");
  await expect(card.getByTestId("item-card-name")).toHaveText(
    "Test Category Ring",
  );
  await expect(card.getByTestId("item-card-category")).toHaveText(
    "Test Ring Category",
  );
});

// An unlabeled category would read as a raw id, so the card names the slot instead.
test("the item card falls back to the slot label for an unlabeled category", async ({
  page,
}) => {
  await equipRingWithCategory(page, { id: "gear_ring" });
  const slotLabel = slotRow(page, RING_SLOT).locator(".slot-label");
  await hoverForCard(page, slotLabel);
  await expect(page.getByTestId("item-card-category")).toHaveText(
    (await slotLabel.innerText()).trim(),
  );
});

test("the Items tab's category list reads a labeled category by its label", async ({
  page,
}) => {
  await openLabeledLayer(page);
  const combo = page.getByTestId("item-list-category");
  await combo.getByTestId("picker-input").fill("Trinket Label");
  const row = pickerMenu(combo).getByRole("option", { name: FILTER_LABEL });
  await expect(row.getByTestId("option-row-id")).toHaveText(FILTER);
  await row.click();
  await expect(
    page.locator(".editor-row", { hasText: "Test Trinket" }),
  ).toBeVisible();
});

// The Items list names each item's category by label, and the id still finds it.
test("the Items list shows an item's category label and finds it by label or id", async ({
  page,
}) => {
  await openLabeledLayer(page);
  const row = page.locator(".editor-row", { hasText: "Test Trinket" });
  const search = page.locator(".editor-search");

  await search.fill(FILTER_LABEL);
  await expect(row.getByTestId("editor-row-secondary")).toHaveText(
    FILTER_LABEL,
  );
  await search.fill(FILTER);
  await expect(row).toBeVisible();
});
