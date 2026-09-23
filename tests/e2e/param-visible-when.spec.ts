// End-to-end coverage for `SlotVisibility.visibleWhen`: the shipped forte params stay hidden
// until a paragon is equipped, and the slot form can author the same kind of condition.
import { test, expect, type Page } from "@playwright/test";
import {
  openBuilder,
  slotRow,
  pickerInput,
  chooseCombo,
  chooseItem,
  chooseClass,
} from "./support/app";
import { newInOutline, openSlotsTab } from "./support/layerEditor";
import { addLayer, layerRow } from "./support/nav";

const FORTE_SLOTS = ["options.forte1", "options.forte2a", "options.forte2b"];

/** Clears an item_picker slot through its own "- empty -" option, the way a user would. */
async function clearSlot(
  page: import("@playwright/test").Page,
  slotId: string,
) {
  const row = slotRow(page, slotId);
  await pickerInput(row).click();
  await row.getByText("- empty -", { exact: true }).click();
}

test("a scoped param appears only while its condition holds", async ({
  page,
}) => {
  await openBuilder(page);

  // Fresh build: no paragon, so no forte rows -- even though the Options section is open.
  await expect(slotRow(page, "options.class")).toBeVisible();
  for (const slotId of FORTE_SLOTS) {
    await expect(slotRow(page, slotId)).toHaveCount(0);
  }

  await chooseClass(page, "warlock");
  await chooseItem(page, "options.paragon", "Hellbringer");
  for (const slotId of FORTE_SLOTS) {
    await expect(slotRow(page, slotId)).toBeVisible();
  }

  await clearSlot(page, "options.paragon");
  for (const slotId of FORTE_SLOTS) {
    await expect(slotRow(page, slotId)).toHaveCount(0);
  }
});

test("an unscoped param is untouched, in its section and in the quick strip", async ({
  page,
}) => {
  await openBuilder(page);
  const quick = page.getByTestId("quick-options");
  await expect(quick).toContainText("Duration (s)");
  await expect(slotRow(page, "options.magnitude")).toBeVisible();

  await chooseClass(page, "warlock");
  await chooseItem(page, "options.paragon", "Hellbringer");

  await expect(quick).toContainText("Duration (s)");
  await expect(slotRow(page, "options.magnitude")).toBeVisible();
});

test("a condition authored in the slot form scopes the row it is on", async ({
  page,
}) => {
  await openBuilder(page);
  await addLayer(page);
  await layerRow(page, "Layer 1").locator(".nav-name").click();
  await openSlotsTab(page);

  await newInOutline(page, "new-slot");
  await page.getByTestId("slot-label-input").fill("Wizard Only");
  await page.getByTestId("slot-path-input").fill("wizardOnly");
  await chooseCombo(page.getByTestId("slot-section-input"), "Options");
  await addClassCondition(page, "wizard", "Wizard");
  await page.getByTestId("save-slot").click();

  await backToBuild(page);
  // No class picked yet, so the condition does not hold and the row stays away.
  await expect(slotRow(page, "options.wizard-only")).toHaveCount(0);
  await chooseClass(page, "wizard");
  await expect(slotRow(page, "options.wizard-only")).toBeVisible();
});

/** Adds one "class is <name>" row to the open form's "Shown when" editor. */
async function addClassCondition(page: Page, query: string, option: string) {
  await page.getByRole("button", { name: "Add condition" }).click();
  const row = page.getByTestId("condition-row").first();
  await row.getByTestId("picker-input").first().click();
  await row.getByText("class", { exact: true }).click();
  const values = row.getByTestId("condition-values");
  await values.getByTestId("token-query").fill(query);
  await values.getByTestId("picker-option").filter({ hasText: option }).click();
}

async function backToBuild(page: Page) {
  await page
    .getByTestId("library")
    .locator(".nav-row--build")
    .first()
    .locator(".nav-name")
    .click();
  await expect(page.getByTestId("builder-content")).toBeVisible();
}
