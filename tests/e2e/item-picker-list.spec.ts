// End-to-end coverage for the `item_picker_list` slot type: rows are added and removed from
// the build editor, and a removal closes the gap rather than leaving a hole. `misc.misc` is the
// shipped list used throughout -- a short one, with a candidate set small enough to assert on.
import { test, expect } from "@playwright/test";
import {
  openBuilder,
  slotRow,
  pickerInput,
  chooseItem,
  addListRows,
  listAddButton,
} from "./support/app";
import { shippedItemName, shippedSlotLabel } from "./support/shippedData";

const LIST = "misc.misc";
const LABEL = shippedSlotLabel(LIST);
const row = (index: number) => `${LIST}#${index}`;

test("a fresh build shows the add button and no rows", async ({ page }) => {
  await openBuilder(page);

  await expect(listAddButton(page, LIST)).toBeVisible();
  await expect(slotRow(page, row(1))).toHaveCount(0);
});

test("adding rows numbers them after the slot's label", async ({ page }) => {
  await openBuilder(page);
  await addListRows(page, LIST, 2);

  await expect(slotRow(page, row(1))).toContainText(`${LABEL} 1`);
  await expect(slotRow(page, row(2))).toContainText(`${LABEL} 2`);
  await expect(slotRow(page, row(3))).toHaveCount(0);
});

test("each row picks independently from the list's own candidates", async ({
  page,
}) => {
  await openBuilder(page);
  await addListRows(page, LIST, 2);

  const first = shippedItemName("vip-hp-bonus-self");
  await chooseItem(page, row(1), first);

  await expect(pickerInput(slotRow(page, row(1)))).toHaveValue(first);
  await expect(pickerInput(slotRow(page, row(2)))).toHaveValue("");
});

test("removing a row closes the gap under it", async ({ page }) => {
  await openBuilder(page);
  await addListRows(page, LIST, 2);

  const kept = shippedItemName("vip-hp-bonus-self");
  await chooseItem(page, row(2), kept);

  await slotRow(page, row(1))
    .getByTestId(`list-remove:${row(1)}`)
    .click();

  // One row left, holding what row 2 held.
  await expect(slotRow(page, row(2))).toHaveCount(0);
  await expect(pickerInput(slotRow(page, row(1)))).toHaveValue(kept);
});

test("an empty row survives a save and reload", async ({ page }) => {
  await openBuilder(page);
  await addListRows(page, LIST, 3);
  await chooseItem(page, row(1), shippedItemName("vip-hp-bonus-self"));

  // Wait for the IDB write to complete before reload.
  // eslint-disable-next-line playwright/no-wait-for-timeout -- No DOM event to observe for IDB flush
  await page.waitForTimeout(500);
  await page.reload();

  await expect(slotRow(page, row(3))).toBeVisible();
  await expect(pickerInput(slotRow(page, row(3)))).toHaveValue("");
});

test("a hand-authored item_picker row has no remove button", async ({
  page,
}) => {
  await openBuilder(page);

  await expect(
    slotRow(page, "gear.head").getByTestId(/^list-remove:/),
  ).toHaveCount(0);
});
