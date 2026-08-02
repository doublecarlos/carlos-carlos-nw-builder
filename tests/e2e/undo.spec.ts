// End-to-end coverage for undo/redo: edit a slot, undo, redo, and verify the undo/redo
// button states follow along.
import { test, expect } from "@playwright/test";
import { openBuilder, chooseItem } from "./support/app";

const HEAD_ITEM = "M29 Enchanted Depthweave Cap (CA)";

test("Ctrl+Z undoes a build slot edit", async ({ page }) => {
  await openBuilder(page);
  const undo = page.getByRole("button", { name: /Undo/ });
  const redo = page.getByRole("button", { name: /Redo/ });

  // Initially nothing to undo/redo
  await expect(undo).toBeDisabled();
  await expect(redo).toBeDisabled();

  // Make a choice, then click the header to move focus away from the picker input
  // so Ctrl+Z reaches our global shortcut instead of being swallowed by the browser's
  // native undo on a focused text field.
  await chooseItem(page, "gear.head", HEAD_ITEM);
  await expect(undo).toBeEnabled();
  await expect(redo).toBeDisabled();
  await page.getByTestId("app-header").click();

  // Ctrl+Z to undo
  await page.keyboard.press("Control+z");
  await expect(undo).toBeDisabled();
  await expect(redo).toBeEnabled();
});

// FIXME: redo shortcut silently swallowed when focus lands on the slot picker input after
// an undo -- see https://github.com/doublecarlos/yet-another-nw-builder/issues/61
test.fixme("Ctrl+Shift+Z redoes after undo", async ({ page }) => {
  await openBuilder(page);
  const undo = page.getByTestId("history-undo");
  const redo = page.getByTestId("history-redo");

  await chooseItem(page, "gear.head", HEAD_ITEM);
  await expect(undo).toBeEnabled();
  await page.getByTestId("app-header").click();

  await page.keyboard.press("Control+z");
  await expect(undo).toBeDisabled();
  await expect(redo).toBeEnabled();

  await page.keyboard.press("Control+Shift+z");
  await expect(undo).toBeEnabled();
  await expect(redo).toBeDisabled();
});

test.fixme("Ctrl+Y redoes after undo", async ({ page }) => {
  await openBuilder(page);
  const undo = page.getByRole("button", { name: /Undo/ });
  const redo = page.getByRole("button", { name: /Redo/ });

  await chooseItem(page, "gear.head", HEAD_ITEM);
  await expect(undo).toBeEnabled();
  await page.getByTestId("app-header").click();

  await page.keyboard.press("Control+z");
  await expect(undo).toBeDisabled();
  await expect(redo).toBeEnabled();

  await page.keyboard.press("Control+y");
  await expect(undo).toBeEnabled();
  await expect(redo).toBeDisabled();
});
