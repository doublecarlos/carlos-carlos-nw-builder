// End-to-end coverage for issue #272: a list parameter authored with `optionsFrom` derives its
// options from the item catalogue, so extending the option set is an item edit rather than a
// slot edit. Driven through the `paragon` tag, which has six distinctly-named items.
import { test, expect, type Page } from "@playwright/test";
import { openBuilder, slotRow, pickerInput } from "./support/app";
import { addLayer, layerRow } from "./support/nav";

const PARAGONS = [
  "Blademaster",
  "Hellbringer",
  "Minstrel",
  "Sentinel",
  "Songblade",
  "Soulweaver",
];

/** Creates a layer, selects it, and opens the Parameters tab. */
async function openParametersTab(page: Page) {
  await addLayer(page);
  await layerRow(page, "Layer 1").locator(".nav-name").click();
  await page.getByTestId("tab-slots").click();
}

async function chooseIn(page: Page, testId: string, label: string) {
  const combo = page.getByTestId(testId);
  await combo.getByTestId("picker-input").click();
  await combo.getByText(label, { exact: true }).click();
}

/** Authors a `list` param deriving its options from the `paragon` tag. */
async function createDerivedParam(page: Page, { allowEmpty = false } = {}) {
  await page.getByTestId("new-slot").click();
  await page.getByTestId("slot-label-input").fill("Preferred paragon");
  await page.getByTestId("slot-path-input").fill("preferredParagon");
  await chooseIn(page, "slot-type-input", "list");
  await chooseIn(page, "slot-section-input", "Options");
  await chooseIn(page, "slot-options-source-input", "items with tags");
  await page.getByTestId("slot-options-tags-input").fill("paragon");
  if (allowEmpty) await page.getByTestId("slot-allow-empty-input").click();
  await page.getByTestId("save-slot").click();
}

test("the form previews how many items the selector matches", async ({
  page,
}) => {
  await openBuilder(page);
  await openParametersTab(page);

  await page.getByTestId("new-slot").click();
  await page.getByTestId("slot-label-input").fill("Preferred paragon");
  await page.getByTestId("slot-path-input").fill("preferredParagon");
  await chooseIn(page, "slot-type-input", "list");
  await chooseIn(page, "slot-options-source-input", "items with tags");

  // A typo'd tag would otherwise look exactly like a tag with no items yet.
  await page.getByTestId("slot-options-tags-input").fill("paragonn");
  await expect(page.getByTestId("slot-derived-preview")).toContainText(
    "no items match",
  );

  await page.getByTestId("slot-options-tags-input").fill("paragon");
  await expect(page.getByTestId("slot-derived-preview")).toContainText(
    "6 option(s)",
  );
  await expect(page.getByTestId("slot-derived-preview")).toContainText(
    PARAGONS.join(", "),
  );
});

test("a derived parameter offers one option per matching item, in name order", async ({
  page,
}) => {
  await openBuilder(page);
  await openParametersTab(page);
  await createDerivedParam(page);

  await page
    .getByTestId("library")
    .locator(".nav-row--build")
    .first()
    .locator(".nav-name")
    .click();
  await expect(page.getByTestId("builder-content")).toBeVisible();

  const row = slotRow(page, "options.preferred-paragon");
  await expect(row).toBeVisible();
  await pickerInput(row).click();
  for (const name of PARAGONS) {
    await expect(row.getByText(name, { exact: true })).toBeVisible();
  }

  // Picking a derived option stores it and equips the item behind it -- a derived option's
  // linkedItem *is* the item it came from, so it can't dangle the way a hand-written one can.
  await row.getByText("Minstrel", { exact: true }).click();
  await expect(pickerInput(row)).toHaveValue("Minstrel");
});

test("the empty row appears only when the parameter asks for it", async ({
  page,
}) => {
  await openBuilder(page);
  await openParametersTab(page);
  await createDerivedParam(page, { allowEmpty: true });

  await page
    .getByTestId("library")
    .locator(".nav-row--build")
    .first()
    .locator(".nav-name")
    .click();
  await expect(page.getByTestId("builder-content")).toBeVisible();

  const row = slotRow(page, "options.preferred-paragon");
  await pickerInput(row).click();
  await expect(row.getByText("— none —", { exact: true })).toBeVisible();
});
