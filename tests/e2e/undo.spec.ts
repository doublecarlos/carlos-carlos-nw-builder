// End-to-end coverage for undo/redo: edit a slot, undo, redo, and verify the undo/redo
// button states follow along.
import { test, expect } from "@playwright/test";
import { openBuilder, chooseItem } from "./support/app";

const HEAD_ITEM = "M29 Enchanted Depthweave Cap (CA)";

test.fixme("Ctrl+Z undoes a build slot edit", async ({ page }) => {
  await openBuilder(page);
  const undo = page.getByRole("button", { name: /Undo/ });
  const redo = page.getByRole("button", { name: /Redo/ });

  // Initially nothing to undo/redo
  await expect(undo).toBeDisabled();
  await expect(redo).toBeDisabled();

  // Make a choice
  await chooseItem(page, "gear.head", HEAD_ITEM);
  await expect(undo).toBeEnabled();
  await expect(redo).toBeDisabled();

  // Ctrl+Z to undo
  await page.keyboard.press("Control+z");
  await expect(undo).toBeDisabled();
  await expect(redo).toBeEnabled();
});

test.fixme("Ctrl+Shift+Z redoes after undo", async ({ page }) => {
  await openBuilder(page);
  const undo = page.getByRole("button", { name: /Undo/ });
  const redo = page.getByRole("button", { name: /Redo/ });

  await chooseItem(page, "gear.head", HEAD_ITEM);
  await expect(undo).toBeEnabled();

  await page.keyboard.press("Control+z");
  await expect(undo).toBeDisabled();
  await expect(redo).toBeEnabled();

  await page.keyboard.press("Control+Shift+z");
  await expect(undo).toBeEnabled();
  await expect(redo).toBeDisabled();
});
