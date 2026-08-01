// End-to-end coverage for the build name input and undo/redo (including the tooltip label
// naming the step it would reverse).
import { test, expect } from "@playwright/test";
import {
  openBuilder,
  chooseItem,
  slotRow,
  pickerInput,
  buildNameInput,
  undoButton,
  redoButton,
} from "./support/app";

const HEAD_ITEM = "M29 Enchanted Depthweave Cap (CA)";

test("renaming via the name field updates the sidebar tab", async ({
  page,
}) => {
  await openBuilder(page);
  await buildNameInput(page).fill("My Warlock");
  await buildNameInput(page).blur();

  await expect(page.getByTestId("library")).toHaveText(/My Warlock/);
});

test("Undo/redo carry a label naming the step, and walk the history back and forth", async ({
  page,
}) => {
  await openBuilder(page);
  await expect(undoButton(page)).toBeDisabled();

  await chooseItem(page, "gear.head", HEAD_ITEM);
  await expect(undoButton(page)).toContainText(HEAD_ITEM);
  await expect(undoButton(page)).toBeEnabled();

  await undoButton(page).click();
  await expect(pickerInput(slotRow(page, "gear.head"))).toHaveValue("");
  await expect(undoButton(page)).toBeDisabled();
  await expect(redoButton(page)).toContainText(HEAD_ITEM);

  await redoButton(page).click();
  await expect(pickerInput(slotRow(page, "gear.head"))).toHaveValue(HEAD_ITEM);
  await expect(redoButton(page)).toBeDisabled();
});
