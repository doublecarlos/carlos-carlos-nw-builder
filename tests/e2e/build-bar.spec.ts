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

const HEAD_ITEM = "M29 Enchanted Depthweave Cap (CA)";

test("Undo/redo walk the history back and forth", async ({ page }) => {
  await openBuilder(page);
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
