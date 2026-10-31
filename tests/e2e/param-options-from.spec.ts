// End-to-end coverage for `optionsFrom`: a list parameter authored with it derives its
// options from the item catalog, so extending the option set is an item edit rather than a
// slot edit. Driven through a test tag carried by a few imported test items.
import { test, expect, type Page } from "@playwright/test";
import { openBuilder, slotRow, pickerInput } from "./support/app";
import { layerRow } from "./support/nav";
import { openSlotsTab, newInOutline } from "./support/layerEditor";
import { importTestCatalog } from "./support/testCatalog";

const TAG = "test-paragon";
const CATALOG_NAME = "Test paragons";
// Listed in name order, which is the order the derived options follow.
const PARAGONS = ["Test Paragon A", "Test Paragon B", "Test Paragon C"];

/** Imports the tagged items, then opens their layer's Slots tab. */
async function openParametersTab(page: Page) {
  await importTestCatalog(page, {
    name: CATALOG_NAME,
    // Imported out of name order, so the derived order is the app's own.
    items: [...PARAGONS].reverse().map((name) => ({
      id: name.toLowerCase().replaceAll(" ", "-"),
      name,
      filter: "test_paragon",
      tags: [TAG],
    })),
  });
  await layerRow(page, `${CATALOG_NAME} (imported)`)
    .locator(".nav-name")
    .click();
  await openSlotsTab(page);
}

async function chooseIn(page: Page, testId: string, label: string) {
  const combo = page.getByTestId(testId);
  await combo.getByTestId("picker-input").click();
  await combo.getByText(label, { exact: true }).click();
}

/** Authors a `list` param deriving its options from `TAG`. */
async function createDerivedParam(page: Page, { allowEmpty = false } = {}) {
  await newInOutline(page, "new-slot");
  await page.getByTestId("slot-label-input").fill("Preferred paragon");
  await page.getByTestId("slot-path-input").fill("preferredParagon");
  await chooseIn(page, "slot-type-input", "list");
  await chooseIn(page, "slot-section-input", "Options");
  await chooseIn(page, "slot-options-source-input", "items with tags");
  await page.getByTestId("slot-options-tags-input").fill(TAG);
  if (allowEmpty) await page.getByTestId("slot-allow-empty-input").click();
  await page.getByTestId("save-slot").click();
}

test("the form previews how many items the selector matches", async ({
  page,
}) => {
  await openBuilder(page);
  await openParametersTab(page);

  await newInOutline(page, "new-slot");
  await page.getByTestId("slot-label-input").fill("Preferred paragon");
  await page.getByTestId("slot-path-input").fill("preferredParagon");
  await chooseIn(page, "slot-type-input", "list");
  await chooseIn(page, "slot-options-source-input", "items with tags");

  // A typo'd tag would otherwise look exactly like a tag with no items yet.
  await page.getByTestId("slot-options-tags-input").fill(`${TAG}n`);
  await expect(page.getByTestId("slot-derived-preview")).toContainText(
    "no items match",
  );

  await page.getByTestId("slot-options-tags-input").fill(TAG);
  await expect(page.getByTestId("slot-derived-preview")).toContainText(
    `${PARAGONS.length} option(s)`,
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
  await row.getByText(PARAGONS[1], { exact: true }).click();
  await expect(pickerInput(row)).toHaveValue(PARAGONS[1]);
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
  await expect(row.getByText("- none -", { exact: true })).toBeVisible();
});
