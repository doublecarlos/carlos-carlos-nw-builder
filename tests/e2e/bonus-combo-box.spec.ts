// End-to-end coverage for the bonus pickers: BonusComboBox, shared by "attach an existing
// bonus" and the occurrence condition rows, and the `excludes` TokenInput, which draws the
// same rows. Rows lead with the name and carry the id, a typed id finds its row first, and an
// occurrence leaf defaults to the bonus it sits in.
import { test, expect, type Page, type Locator } from "@playwright/test";
import {
  comboBoxClear,
  comboBoxValueId,
  confirmImport,
  importText,
  openBuilder,
  pickerMenu,
  setItemFilter,
} from "./support/app";
import { layerRow } from "./support/nav";

const LAYER_NAME = "Picker layer";
// One id is a prefix of the other, so a query for the short one matches both rows; listed by
// name, the longer id's row would otherwise come first.
const SHORT_ID = "test-pick";
const LONG_ID = "test-pick-longer";

const bundle = JSON.stringify({
  builds: [],
  layers: [
    {
      id: "l_picker",
      name: LAYER_NAME,
      enabled: true,
      overlay: {
        items: {},
        bonuses: {
          [SHORT_ID]: { id: SHORT_ID, name: "Zed Pick", grants: [] },
          [LONG_ID]: { id: LONG_ID, name: "Aardvark Pick", grants: [] },
        },
        sectionPresets: {},
        slots: {},
      },
    },
  ],
});

/** Imports the fixture layer, opens its Bonuses tab, starts a new bonus with one grant and
 *  one condition leaf switched to "occurrences", and returns that leaf's row. */
async function openOccurrenceLeaf(page: Page): Promise<Locator> {
  await openBuilder(page);
  await importText(page, bundle);
  await confirmImport(page);
  await layerRow(page, LAYER_NAME).locator(".nav-name").click();
  await page.getByRole("button", { name: /Bonuses \d+/ }).click();
  await page.getByTestId("new-bonus").click();
  await page.getByLabel("Add grant").click();
  await page.getByLabel("Add condition").click();
  const row = page.getByTestId("condition-row").first();
  await row.getByTestId("picker-input").first().click();
  await pickerMenu(row).getByText("occurrences", { exact: true }).click();
  return row;
}

/** The leaf's bonus picker: the second combobox on the row, after the leaf type's. */
const bonusPicker = (row: Locator) => row.getByTestId("picker-input").nth(1);

/** The open menu's choosable rows, by role, which the "N more" footer row does not carry. */
const menuOptions = (page: Page) =>
  page.getByTestId("picker-menu").getByRole("option");

async function grantJson(page: Page): Promise<string> {
  const grant = page.getByTestId("bonus-grant-row").first();
  await grant.getByLabel("Edit as JSON").click();
  return grant.locator("textarea").inputValue();
}

test("an occurrence leaf starts on the bonus it sits in and saves no bonus id", async ({
  page,
}) => {
  const row = await openOccurrenceLeaf(page);
  await expect(bonusPicker(row)).toHaveValue("this bonus");

  const json = await grantJson(page);
  expect(json).toContain('"bonusOccurrences": {}');
  expect(json).not.toContain('"bonus"');
});

test("rows lead with the name and carry the id, and 'this bonus' heads the untyped list", async ({
  page,
}) => {
  const row = await openOccurrenceLeaf(page);
  await bonusPicker(row).click();

  const options = menuOptions(page);
  await expect(options.first()).toHaveText("this bonus");
  const aardvark = options.filter({ hasText: "Aardvark Pick" });
  await expect(aardvark.getByTestId("option-row-id")).toHaveText(LONG_ID);
});

test("typing an exact id lists that bonus first and picks it by id", async ({
  page,
}) => {
  const row = await openOccurrenceLeaf(page);
  const picker = bonusPicker(row);
  await picker.click();
  await picker.fill(SHORT_ID);

  const options = menuOptions(page);
  await expect(options).toHaveCount(2);
  await expect(options.first()).toContainText("Zed Pick");
  await options.first().click();
  await expect(picker).toHaveValue("Zed Pick");

  const json = await grantJson(page);
  expect(json).toContain(`"bonus": "${SHORT_ID}"`);
});

test("the item form's attach picker lists bonuses by name with their id", async ({
  page,
}) => {
  await openBuilder(page);
  await importText(page, bundle);
  await confirmImport(page);
  await layerRow(page, LAYER_NAME).locator(".nav-name").click();
  await page.getByTestId("new-item").click();
  await setItemFilter(page, "gear_head");

  const attach = page.getByPlaceholder("attach an existing one…");
  await attach.click();
  await attach.fill("aardvark");
  const options = menuOptions(page);
  await expect(options).toHaveCount(1);
  await expect(options.first().getByTestId("option-row-id")).toHaveText(
    LONG_ID,
  );
});

test("the excludes editor offers the same name-and-id rows, by id or name, and never a free entry", async ({
  page,
}) => {
  await openBuilder(page);
  await importText(page, bundle);
  await confirmImport(page);
  await layerRow(page, LAYER_NAME).locator(".nav-name").click();
  await page.getByRole("button", { name: /Bonuses \d+/ }).click();
  await page.getByTestId("new-bonus").click();

  const excludes = page.getByTestId("bonus-excludes-input");
  const query = excludes.getByTestId("token-query");
  await query.click();
  await query.fill("pick");
  const options = menuOptions(page);
  await expect(options).toHaveCount(2);
  await expect(options.first().getByTestId("option-row-id")).toHaveText(
    LONG_ID,
  );

  // A closed vocabulary: text matching nothing offers nothing, not a "new" entry.
  await query.fill("no-such-bonus");
  await expect(page.getByTestId("picker-menu")).toHaveCount(0);

  await query.fill(SHORT_ID);
  await expect(options.first()).toContainText("Zed Pick");
  await options.first().click();
  const chip = excludes.getByTestId("token-chip");
  await expect(chip).toHaveText(/Zed Pick/);
  await expect(chip).toHaveAttribute("data-value", SHORT_ID);
});

// A closed picker names the bonus and its id, so neither half of an open row is lost once
// picked; opening it keeps the pick in view as the placeholder.
test("a picked bonus reads its name with the id beside it, and stays as the open placeholder", async ({
  page,
}) => {
  const row = await openOccurrenceLeaf(page);
  const picker = bonusPicker(row);
  await picker.click();
  await menuOptions(page).filter({ hasText: "Aardvark Pick" }).click();

  await expect(picker).toHaveValue("Aardvark Pick");
  await expect(comboBoxValueId(picker)).toHaveText(LONG_ID);

  await picker.click();
  await expect(picker).toHaveValue("");
  await expect(picker).toHaveAttribute("placeholder", "Aardvark Pick");
});

// "this bonus" is the empty value, so it has no id beside it and nothing to clear.
test("the clear button returns an occurrence leaf to this bonus, and a required pick has none", async ({
  page,
}) => {
  const row = await openOccurrenceLeaf(page);
  const picker = bonusPicker(row);
  await expect(comboBoxValueId(picker)).toHaveCount(0);
  await expect(comboBoxClear(picker)).toHaveCount(0);
  // The leaf type is always set, so its picker offers no way to empty it.
  await expect(
    comboBoxClear(row.getByTestId("picker-input").first()),
  ).toHaveCount(0);

  await picker.click();
  await picker.fill(SHORT_ID);
  await menuOptions(page).filter({ hasText: "Zed Pick" }).click();
  await comboBoxClear(picker).click();
  await expect(picker).toHaveValue("this bonus");
  await expect(comboBoxClear(picker)).toHaveCount(0);
});

// The inline picker is narrow, so the id has to give way to the name rather than overlap it or
// spill out of the box.
test(
  "a closed picker's id sits after the name and inside the box",
  { tag: "@cross-browser" },
  async ({ page }) => {
    const row = await openOccurrenceLeaf(page);
    const picker = bonusPicker(row);
    await picker.click();
    await menuOptions(page).filter({ hasText: "Aardvark Pick" }).click();

    const id = comboBoxValueId(picker);
    const labelCopy = id.locator("xpath=preceding-sibling::span");
    const box = (await picker.boundingBox())!;
    const idBox = (await id.boundingBox())!;
    const labelBox = (await labelCopy.boundingBox())!;
    expect(idBox.width).toBeGreaterThan(0);
    expect(idBox.x).toBeGreaterThanOrEqual(labelBox.x + labelBox.width);
    expect(idBox.x + idBox.width).toBeLessThanOrEqual(box.x + box.width);
    expect(idBox.y).toBeGreaterThanOrEqual(box.y);
    expect(idBox.y + idBox.height).toBeLessThanOrEqual(box.y + box.height);
  },
);

// The id may be cut short in the narrow box, so hovering the closed picker shows the name and
// the full id; an open picker has its list instead, and no bubble over it.
test("a closed picker's tooltip names the bonus and its full id, and an open one has none", async ({
  page,
}) => {
  const row = await openOccurrenceLeaf(page);
  const picker = bonusPicker(row);
  await picker.click();
  await menuOptions(page).filter({ hasText: "Aardvark Pick" }).click();

  const tooltip = page.getByTestId("tooltip");
  await picker.hover();
  await expect(tooltip).toContainText("Aardvark Pick");
  await expect(tooltip).toContainText(LONG_ID);

  await picker.click();
  await expect(page.getByRole("listbox")).toBeVisible();
  await expect(tooltip).toHaveCount(0);

  // Keyboard focus opens the list too, which takes the place of the bubble.
  await picker.press("Escape");
  await page.mouse.move(0, 0);
  // A script's focus right after a key press reads as keyboard focus.
  await picker.focus();
  await expect(page.getByRole("listbox")).toBeVisible();
  await expect(tooltip).toHaveCount(0);
});
