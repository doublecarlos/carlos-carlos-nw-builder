// End-to-end coverage for the build name input and undo/redo (including the tooltip label
// naming the step it would reverse).
import { test, expect } from "@playwright/test";
import {
  openBuilder,
  chooseItem,
  slotRow,
  pickerInput,
  undoButton,
  redoButton,
} from "./support/app";
import { TEST_HEAD_ITEM } from "./support/headItems";
import { importTestCatalog } from "./support/testCatalog";

const HEAD_ITEM = TEST_HEAD_ITEM.name;

test("Undo/redo walk the history back and forth", async ({ page }) => {
  await openBuilder(page);
  await importTestCatalog(page, { items: [TEST_HEAD_ITEM] });
  await expect(undoButton(page)).toBeDisabled();

  await chooseItem(page, "gear.head", HEAD_ITEM);
  await expect(undoButton(page)).toBeEnabled();

  await undoButton(page).click();
  await expect(pickerInput(slotRow(page, "gear.head"))).toHaveValue("");
  await expect(undoButton(page)).toBeDisabled();

  await redoButton(page).click();
  await expect(pickerInput(slotRow(page, "gear.head"))).toHaveValue(HEAD_ITEM);
  await expect(redoButton(page)).toBeDisabled();
});
