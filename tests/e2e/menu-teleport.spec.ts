// ComboBoxMenu lives in <body>, away from its row. Picking still parks the row cursor, and the
// menu sits against its input inside a sideways-scrolled section body.
import { test, expect } from "@playwright/test";
import {
  cursorKey,
  expandAllSections,
  openBuilder,
  pickerInput,
  pickerMenu,
  slotRow,
} from "./support/app";
import { expectTopmost } from "./support/occlusion";

test("clicking a menu row keeps the cursor on the row the picker belongs to", async ({
  page,
}) => {
  await openBuilder(page);
  const row = slotRow(page, "gear.head");
  await pickerInput(row).click();
  await pickerMenu(row).getByTestId("picker-option").nth(1).click();

  await expect(pickerMenu(row)).toHaveCount(0);
  await expect.poll(() => cursorKey(page)).toBe("slot:gear.head");
});

test("a picker in a sideways-scrolled point section opens against its input", async ({
  page,
}) => {
  // Narrow enough for the boon steppers to overflow the section body.
  await page.setViewportSize({ width: 820, height: 900 });
  await openBuilder(page);
  await expandAllSections(page);
  const row = slotRow(page, "boons.guildOffense");
  await row.scrollIntoViewIfNeeded();
  await row.evaluate((el) => {
    const body = el.closest<HTMLElement>('[data-testid="section-body"]')!;
    body.scrollLeft = body.scrollWidth;
  });

  const input = pickerInput(row);
  await input.click();
  const shell = page.getByTestId("picker-shell");
  await expect(shell).toBeVisible();
  await expectTopmost(pickerMenu(row));

  const inputBox = (await input.boundingBox())!;
  const menuBox = (await shell.boundingBox())!;
  expect(Math.abs(menuBox.x - inputBox.x)).toBeLessThan(2);
  const gapBelow = menuBox.y - (inputBox.y + inputBox.height);
  const gapAbove = inputBox.y - (menuBox.y + menuBox.height);
  expect(Math.min(Math.abs(gapBelow), Math.abs(gapAbove))).toBeLessThan(6);
});
