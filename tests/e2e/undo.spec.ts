// End-to-end coverage for undo/redo: edit a slot, undo, redo, and verify the undo/redo
// button states follow along.
import { test, expect, type Page } from "@playwright/test";
import {
  openBuilder,
  chooseItem,
  blurToHeader,
  undoButton,
  redoButton,
} from "./support/app";

const HEAD_ITEM = "M29 Enchanted Depthweave Cap";

/** The About dialog is the simplest overlay to raise: one header button, no import wizard. */
const aboutDialog = (page: Page) => page.getByTestId("about-dialog");

test("Ctrl+Z undoes a build slot edit", async ({ page }) => {
  await openBuilder(page);
  const undo = undoButton(page);
  const redo = redoButton(page);

  // Initially nothing to undo/redo
  await expect(undo).toBeDisabled();
  await expect(redo).toBeDisabled();

  // Make a choice, then click the header to move focus away from the picker input
  // so Ctrl+Z reaches our global shortcut instead of being swallowed by the browser's
  // native undo on a focused text field.
  await chooseItem(page, "gear.head", HEAD_ITEM);
  await expect(undo).toBeEnabled();
  await expect(redo).toBeDisabled();
  await blurToHeader(page);

  // Ctrl+Z to undo
  await page.keyboard.press("Control+z");
  await expect(undo).toBeDisabled();
  await expect(redo).toBeEnabled();
});

// FIXME: redo shortcut silently swallowed when focus lands on the slot picker input after
// an undo.
test.fixme("Ctrl+Shift+Z redoes after undo", async ({ page }) => {
  await openBuilder(page);
  const undo = undoButton(page);
  const redo = redoButton(page);

  await chooseItem(page, "gear.head", HEAD_ITEM);
  await expect(undo).toBeEnabled();
  await blurToHeader(page);

  await page.keyboard.press("Control+z");
  await expect(undo).toBeDisabled();
  await expect(redo).toBeEnabled();

  await page.keyboard.press("Control+Shift+z");
  await expect(undo).toBeEnabled();
  await expect(redo).toBeDisabled();
});

test.fixme("Ctrl+Y redoes after undo", async ({ page }) => {
  await openBuilder(page);
  const undo = undoButton(page);
  const redo = redoButton(page);

  await chooseItem(page, "gear.head", HEAD_ITEM);
  await expect(undo).toBeEnabled();
  await blurToHeader(page);

  await page.keyboard.press("Control+z");
  await expect(undo).toBeDisabled();
  await expect(redo).toBeEnabled();

  await page.keyboard.press("Control+y");
  await expect(undo).toBeEnabled();
  await expect(redo).toBeDisabled();
});

test("a modal blocks the undo shortcut", async ({ page }) => {
  await openBuilder(page);
  const undo = undoButton(page);
  const redo = redoButton(page);

  await chooseItem(page, "gear.head", HEAD_ITEM);
  await expect(undo).toBeEnabled();
  await blurToHeader(page);

  // Raise an overlay: it takes focus and owns the keyboard until it closes.
  await page.getByTestId("header-about").click();
  await expect(aboutDialog(page)).toBeVisible();

  // The shortcut stays put rather than reaching the build behind the overlay.
  await page.keyboard.press("Control+z");
  await expect(undo).toBeEnabled();
  await expect(redo).toBeDisabled();

  // Close via the button, so this test does not depend on Escape: BaseModal's Escape path
  // is covered by base-modal.spec.ts.
  await page.getByTestId("modal-close").click();
  await expect(aboutDialog(page)).toBeHidden();

  await page.keyboard.press("Control+z");
  await expect(undo).toBeDisabled();
  await expect(redo).toBeEnabled();
});
