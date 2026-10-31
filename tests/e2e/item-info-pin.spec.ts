// On trial (`DESKTOP_ITEM_INFO` in src/lib/experiments.ts): a filled slot's info button pins
// its item card beside the row on desktop, as a findable, lasting alternative to the hover
// card. Drop this spec along with the flag if the trial is not kept.
import { test, expect } from "@playwright/test";
import { chooseItem, openBuilder, slotRow } from "./support/app";
import { TEST_HEAD, importTestHead } from "./support/testHead";

test("the info button pins the card until dismissed", async ({ page }) => {
  await openBuilder(page);
  await importTestHead(page);
  await chooseItem(page, "gear.head", TEST_HEAD.name);

  const info = page.getByTestId("slot-info:gear.head");
  const pinned = page.getByTestId("item-card-pinned");
  await info.click();
  await expect(pinned).toContainText(TEST_HEAD.name);
  // Beside its row, not over it.
  const row = (await slotRow(page, "gear.head").boundingBox())!;
  const card = (await pinned.boundingBox())!;
  expect(card.y + card.height).toBeGreaterThan(row.y);
  expect(card.y).toBeLessThan(row.y + row.height + 400);

  // Pressing the button again, Escape and a click elsewhere each unpin it.
  await info.click();
  await expect(pinned).toHaveCount(0);
  await info.click();
  await page.keyboard.press("Escape");
  await expect(pinned).toHaveCount(0);
  await info.click();
  await page.getByTestId("app-header").click({ position: { x: 5, y: 5 } });
  await expect(pinned).toHaveCount(0);
});
