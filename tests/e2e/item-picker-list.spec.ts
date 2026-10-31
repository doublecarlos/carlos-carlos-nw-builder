// End-to-end coverage for the `item_picker_list` slot type: rows are added and removed from
// the build editor, and a removal closes the gap rather than leaving a hole. `misc.misc` is the
// shipped list used throughout, picking from a test item.
import { test, expect, type Page } from "@playwright/test";
import {
  openBuilder,
  slotRow,
  pickerInput,
  chooseItem,
  addListRows,
  listAddButton,
} from "./support/app";
import { shippedSlotLabel } from "./support/shippedData";
import { storedBuilds } from "./support/storage";
import { importTestCatalog } from "./support/testCatalog";

const LIST = "misc.misc";
const LABEL = shippedSlotLabel(LIST);
const row = (index: number) => `${LIST}#${index}`;

const BUILD = "Test misc list";
const MISC_ITEM = {
  id: "test-misc-item",
  name: "Test Misc Item",
  filter: "misc",
};

/** A build with the test item among the list's candidates. */
async function openWithMiscItem(page: Page) {
  await openBuilder(page);
  await importTestCatalog(page, { name: BUILD, items: [MISC_ITEM] });
}

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
  await openWithMiscItem(page);
  await addListRows(page, LIST, 2);

  const first = MISC_ITEM.name;
  await chooseItem(page, row(1), first);

  await expect(pickerInput(slotRow(page, row(1)))).toHaveValue(first);
  await expect(pickerInput(slotRow(page, row(2)))).toHaveValue("");
});

test("removing a row closes the gap under it", async ({ page }) => {
  await openWithMiscItem(page);
  await addListRows(page, LIST, 2);

  const kept = MISC_ITEM.name;
  await chooseItem(page, row(2), kept);

  await slotRow(page, row(1))
    .getByTestId(`list-remove:${row(1)}`)
    .click();

  // One row left, holding what row 2 held.
  await expect(slotRow(page, row(2))).toHaveCount(0);
  await expect(pickerInput(slotRow(page, row(1)))).toHaveValue(kept);
});

test("an empty row survives a save and reload", async ({ page }) => {
  await openWithMiscItem(page);
  await addListRows(page, LIST, 3);
  await chooseItem(page, row(1), MISC_ITEM.name);

  await expect
    .poll(async () => {
      const build = (await storedBuilds(page)).find((b) => b.name === BUILD);
      return [build?.listRows[LIST], build?.choices[row(1)]];
    })
    .toEqual([3, MISC_ITEM.id]);
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
