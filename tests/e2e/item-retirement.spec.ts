// End-to-end coverage for retiring an item: `Item.hideFromPicker` withholds it from pickers
// offering a new choice, and `Item.replacedBy` offers a build holding it a swap onto its
// successor -- an offer, never an automatic redirect, so accepting it is a visible change.
//
// Items are built through the real layer editor rather than by editing shipped game data, the
// same way item-picker-hide-from-picker.spec.ts does for the grant-level flag: nothing shipped
// is retired yet, and pinning this on entries that exist today would make it hostage to a data
// edit.
import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";
import { openBuilder, slotRow, pickerInput, chooseItem } from "./support/app";
import { addLayer, layerRow } from "./support/nav";

const OLD_ITEM = "ZZZ Test Retired Ring";
const NEW_ITEM = "ZZZ Test Replacement Ring";

async function createItem(page: Page, name: string) {
  await page.getByTestId("new-item").click();
  await page.getByTestId("item-name-input").fill(name);
  await page.getByTestId("item-filter-input").fill("gear_ring");
  await page.getByRole("button", { name: "Save item" }).click();
}

/** Opens the layer editor on the layer created by `addLayer`. */
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

/** Edits an existing item in the open layer editor, ticking "hide from pickers" and optionally
 *  naming a replacement. Edits are live for an existing item, so there is no Save to click. */
async function retireItem(page: Page, name: string, replacedBy?: string) {
  await page.locator(".editor-row-name", { hasText: name }).first().click();
  await page.getByTestId("item-hide-from-picker").click();
  if (replacedBy) {
    const combo = page.getByTestId("item-replaced-by");
    await combo.locator("input").click();
    await combo.locator("input").fill(replacedBy);
    await page
      .getByText(new RegExp(`^${replacedBy} \\(`), { exact: false })
      .last()
      .click();
  }
}

/** Creates an item whose one stat is a player-typed magnitude, through the same repeatable
 *  dynamic-stat rows item-editor-groups.spec.ts drives. */
async function createDynamicItem(page: Page, name: string) {
  await page.getByTestId("new-item").click();
  await page.getByTestId("item-name-input").fill(name);
  await page.getByTestId("item-filter-input").fill("gear_ring");
  await page.getByRole("button", { name: "Add dynamic stat" }).first().click();
  // Positional number inputs and the picker's own testid, the same way
  // item-editor-groups.spec.ts drives these rows -- FormField renders a bare span, so its
  // label is not associated with the control and `getByLabel` finds nothing.
  const row = page.locator(".dynamic-stat-row").last();
  const statPicker = row.getByTestId("picker-input");
  await statPicker.click();
  await statPicker.fill("Power");
  await row.getByText("Power", { exact: true }).click();
  const numbers = row.locator('input[type="number"]');
  await numbers.nth(0).fill("0");
  await numbers.nth(1).fill("1000");
  await numbers.nth(2).fill("500");
  await page.getByRole("button", { name: "Save item" }).click();
}

test("a retirement carries its own value onto the replacement's dynamic stat", async ({
  page,
}) => {
  await openBuilder(page);
  await addLayer(page);
  await openLayer(page);
  await createItem(page, OLD_ITEM);
  await createDynamicItem(page, NEW_ITEM);

  await openBuild(page);
  await chooseItem(page, "gear.ring1", OLD_ITEM);

  await openLayer(page);
  await retireItem(page, OLD_ITEM, NEW_ITEM);
  // The value this retired item hands to the replacement, instead of its default of 500.
  await page.getByTestId("item-add-carried-value").click();
  const carried = page.locator(".replaced-by-value-row").last();
  const carriedStat = carried.getByTestId("picker-input");
  await carriedStat.click();
  await carriedStat.fill("Power");
  await carried.getByText("Power", { exact: true }).click();
  await carried.locator('input[type="number"]').fill("200");

  await openBuild(page);
  const row = slotRow(page, "gear.ring1");
  await row.scrollIntoViewIfNeeded();

  // Until the offer is accepted the build still holds the retired item, which has no dynamic
  // stat of its own -- so there is no stepper on the row at all.
  await expect(pickerInput(row)).toHaveValue(OLD_ITEM);
  await expect(row.getByTestId("slot-dynamic:power")).toHaveCount(0);

  // Accepting it swaps the item and seeds the stepper with the value carried across, rather
  // than the replacement's own default of 500.
  await page.getByTestId("retired-items-apply").click();
  await expect(page.getByTestId("retired-items")).toHaveCount(0);
  await expect(pickerInput(row)).toHaveValue(NEW_ITEM);
  await expect(row.getByTestId("slot-dynamic:power")).toHaveValue("200");
});

test("each retired row carries its own badge and update button", async ({
  page,
}) => {
  await openBuilder(page);
  await addLayer(page);
  await openLayer(page);
  await createItem(page, OLD_ITEM);
  await createItem(page, NEW_ITEM);

  await openBuild(page);
  await chooseItem(page, "gear.ring1", OLD_ITEM);
  await chooseItem(page, "gear.ring2", OLD_ITEM);

  await openLayer(page);
  await retireItem(page, OLD_ITEM, NEW_ITEM);

  await openBuild(page);
  const first = slotRow(page, "gear.ring1");
  const second = slotRow(page, "gear.ring2");
  await first.scrollIntoViewIfNeeded();

  await expect(page.getByTestId("slot-retired:gear.ring1")).toBeVisible();
  await expect(page.getByTestId("slot-retired:gear.ring2")).toBeVisible();
  await expect(page.getByTestId("retired-items")).toContainText(
    "1 retired item",
  );

  // One row at a time: the other keeps its retired pick, and the build-wide notice stays up
  // for it.
  await page.getByTestId("slot-retired-apply:gear.ring1").click();
  await expect(pickerInput(first)).toHaveValue(NEW_ITEM);
  await expect(page.getByTestId("slot-retired:gear.ring1")).toHaveCount(0);
  await expect(pickerInput(second)).toHaveValue(OLD_ITEM);
  await expect(page.getByTestId("slot-retired:gear.ring2")).toBeVisible();
  await expect(page.getByTestId("retired-items")).toBeVisible();

  await page.getByTestId("slot-retired-apply:gear.ring2").click();
  await expect(pickerInput(second)).toHaveValue(NEW_ITEM);
  await expect(page.getByTestId("retired-items")).toHaveCount(0);
});

test("a hidden item leaves every picker except the slot already holding it", async ({
  page,
}) => {
  await openBuilder(page);
  await addLayer(page);
  await openLayer(page);
  await createItem(page, OLD_ITEM);

  await openBuild(page);
  await chooseItem(page, "gear.ring1", OLD_ITEM);

  await openLayer(page);
  await retireItem(page, OLD_ITEM);

  await openBuild(page);
  const head = slotRow(page, "gear.ring1");
  await head.scrollIntoViewIfNeeded();

  // Still equipped, still named: hiding withholds new picks, it does not unequip.
  await expect(pickerInput(head)).toHaveValue(OLD_ITEM);

  // And still offered here, so the pick can be cleared and restored.
  await pickerInput(head).click();
  await expect(
    head.getByTestId("picker-menu").getByText(OLD_ITEM, { exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Escape");

  // But gone from a different slot of the same kind.
  const other = slotRow(page, "gear.ring2");
  await other.scrollIntoViewIfNeeded();
  await pickerInput(other).click();
  await expect(
    other.getByTestId("picker-menu").getByText(OLD_ITEM, { exact: true }),
  ).toHaveCount(0);
});

test("a replaced item keeps its slot until the offer is accepted", async ({
  page,
}) => {
  await openBuilder(page);
  await addLayer(page);
  await openLayer(page);
  await createItem(page, OLD_ITEM);
  await createItem(page, NEW_ITEM);

  await openBuild(page);
  await chooseItem(page, "gear.ring1", OLD_ITEM);

  await openLayer(page);
  await retireItem(page, OLD_ITEM, NEW_ITEM);

  await openBuild(page);
  const head = slotRow(page, "gear.ring1");
  await head.scrollIntoViewIfNeeded();

  // The build still holds what it was saved with: a retirement offers a swap, it does not
  // perform one.
  await expect(pickerInput(head)).toHaveValue(OLD_ITEM);

  const notice = page.getByTestId("retired-items");
  await expect(notice).toContainText("1 retired item");

  // Accepting it is what actually changes the row -- the visible half of the offer.
  await page.getByTestId("retired-items-apply").click();
  await expect(notice).toHaveCount(0);
  await expect(pickerInput(head)).toHaveValue(NEW_ITEM);
});
