// A category-wide copy cap reaching the two places a player meets it: the picker withholding
// an item equipped elsewhere, and the editor saying what a blank field resolves to. Items are
// authored through the layer editor, so nothing depends on shipped data keeping its own cap.
import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";
import { openBuilder, slotRow, pickerInput, chooseItem } from "./support/app";
import { addLayer, layerRow } from "./support/nav";
import { shippedItemName } from "./support/shippedData";
import { undoButton } from "./support/app";

const INHERITED_ITEM = "ZZZ Test Inherited Ring";
const OPTED_OUT_ITEM = "ZZZ Test Repeatable Ring";

async function createItem(
  page: Page,
  name: string,
  { maxCopies }: { maxCopies?: number } = {},
) {
  await page.getByTestId("new-item").click();
  await page.getByTestId("item-name-input").fill(name);
  await page.getByTestId("item-filter-input").fill("gear_ring");
  if (maxCopies !== undefined) {
    await page.getByTestId("item-max-copies").fill(String(maxCopies));
  }
  await page.getByRole("button", { name: "Save item" }).click();
}

async function openLayer(page: Page) {
  await layerRow(page, "Layer 1").locator(".nav-name").click();
}

async function openBuild(page: Page) {
  await page
    .getByTestId("library")
    .locator(".nav-row--build")
    .first()
    .locator(".nav-name")
    .click();
  await expect(page.getByTestId("builder-content")).toBeVisible();
}

async function reopenItem(page: Page, name: string) {
  await page.locator(".editor-row-name", { hasText: name }).first().click();
}

test("an item with no cap of its own is held to its filter's", async ({
  page,
}) => {
  await openBuilder(page);
  await addLayer(page);
  await openLayer(page);
  await createItem(page, INHERITED_ITEM);

  // The form says what the blank field resolves to, so inheriting a cap is not invisible.
  await reopenItem(page, INHERITED_ITEM);
  await expect(page.getByTestId("item-max-copies")).toHaveValue("");
  await expect(page.getByTestId("item-max-copies")).toHaveAttribute(
    "placeholder",
    "1 for this filter",
  );

  await openBuild(page);
  await chooseItem(page, "gear.ring1", INHERITED_ITEM);

  const other = slotRow(page, "gear.ring2");
  await other.scrollIntoViewIfNeeded();
  const input = pickerInput(other);
  await input.click();
  await input.fill(INHERITED_ITEM);
  await expect(
    other.getByTestId("picker-menu").getByText(INHERITED_ITEM, { exact: true }),
  ).toHaveCount(0);
  await page.keyboard.press("Escape");

  await page.getByTestId("show-hidden-toggle").click();
  await other.scrollIntoViewIfNeeded();
  await input.click();
  await input.fill(INHERITED_ITEM);
  await expect(other.getByTestId("picker-option-hidden-reason")).toHaveText(
    "1/1 copies",
  );
});

test("a typed 0 opts an item out of its filter's cap", async ({ page }) => {
  await openBuilder(page);
  await addLayer(page);
  await openLayer(page);
  await createItem(page, OPTED_OUT_ITEM, { maxCopies: 0 });

  // Blank and 0 both resolve to unlimited, so only the saved field tells them apart.
  await reopenItem(page, OPTED_OUT_ITEM);
  await expect(page.getByTestId("item-max-copies")).toHaveValue("0");

  await openBuild(page);
  await chooseItem(page, "gear.ring1", OPTED_OUT_ITEM);
  await chooseItem(page, "gear.ring2", OPTED_OUT_ITEM);

  await expect(pickerInput(slotRow(page, "gear.ring1"))).toHaveValue(
    OPTED_OUT_ITEM,
  );
  await expect(pickerInput(slotRow(page, "gear.ring2"))).toHaveValue(
    OPTED_OUT_ITEM,
  );
});

// Both ways back out of an edit have to reach the blank field again, not a stored 0.
const SHIPPED_RING = shippedItemName("m31-bloodlit-veil-ca-power");

async function editShippedRing(page: Page) {
  await page.locator(".editor-search").fill(SHIPPED_RING);
  await page
    .locator(".editor-row-name", { hasText: SHIPPED_RING })
    .first()
    .click();
  await expect(page.getByTestId("item-max-copies")).toHaveValue("");
  await page.getByTestId("item-max-copies").fill("0");
}

test("reverting to shipped clears an authored 0 back to blank", async ({
  page,
}) => {
  await openBuilder(page);
  await addLayer(page);
  await openLayer(page);
  await editShippedRing(page);

  await page.getByRole("button", { name: "Revert to shipped" }).click();
  await expect(page.getByTestId("item-max-copies")).toHaveValue("");
});

test("undoing an authored 0 leaves the field blank again", async ({ page }) => {
  await openBuilder(page);
  await addLayer(page);
  await openLayer(page);
  await editShippedRing(page);

  await expect(undoButton(page)).toBeEnabled();
  await undoButton(page).click();
  await expect(page.getByTestId("item-max-copies")).toHaveValue("");
});
