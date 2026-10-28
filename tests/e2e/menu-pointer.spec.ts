// Rows scrolling under a still pointer do not take a dropdown's highlight from the keyboard.
import { test, expect, type Locator } from "@playwright/test";
import { openBuilder, pickerInput, slotRow } from "./support/app";

/** Position of the highlighted row among the menu's choosable rows. */
const highlightedIndex = (menu: Locator) =>
  menu
    .getByTestId("picker-option")
    .evaluateAll((rows) =>
      rows.findIndex((row) => row.hasAttribute("data-highlighted")),
    );

test("arrow keys keep the highlight while the menu scrolls under a still pointer", async ({
  page,
}) => {
  await openBuilder(page);
  const row = slotRow(page, "gear.head");
  await pickerInput(row).click();
  const menu = row.getByTestId("picker-menu");

  const box = await menu.boundingBox();
  expect(box).not.toBeNull();
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
  const start = await highlightedIndex(menu);

  const steps = 10;
  for (let i = 0; i < steps; i++) await pickerInput(row).press("ArrowDown");
  await expect.poll(() => highlightedIndex(menu)).toBe(start + steps);
});
