// A jump scrolls rows under a still pointer. The row that lands under it gets no hover card
// until the pointer moves; then the card opens for it without a fresh `mouseenter`.
import { test, expect, type Page } from "@playwright/test";
import { openBuilder, slotRow, cursorRow, chooseItem } from "./support/app";
import { shippedItemName, shippedSlotLabel } from "./support/shippedData";

const PANTS_ITEM = shippedItemName("m31-bloodwoven-sigils-ca");

/** The shared hover card, teleported to `<body>` by BasePopover. */
function card(page: Page) {
  return page.locator(".itemcard");
}

/** Jumps to a slot through the palette, keyboard only, so the pointer stays where it is. */
async function jumpToSlot(page: Page, slotId: string) {
  await page.keyboard.press("ControlOrMeta+k");
  const input = page.getByTestId("go-to-input");
  await expect(input).toBeFocused();
  await input.fill(shippedSlotLabel(slotId));
  await expect(page.getByTestId(`go-to-option-slot:${slotId}`)).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(cursorRow(page)).toHaveAttribute(
    "data-cursor-key",
    `slot:${slotId}`,
  );
}

/** The row's box once the jump scroll has come to rest. */
async function settledBox(page: Page, slotId: string) {
  const row = slotRow(page, slotId);
  let last = await row.boundingBox();
  await expect
    .poll(async () => {
      const next = await row.boundingBox();
      const settled = next?.y === last?.y;
      last = next;
      return settled;
    })
    .toBe(true);
  if (!last) throw new Error(`slot row "${slotId}" has no layout box`);
  return last;
}

test("a row scrolled under a still pointer opens no card until the pointer moves", async ({
  page,
}) => {
  await page.clock.install();
  await openBuilder(page);
  await chooseItem(page, "gear.pants", PANTS_ITEM);

  // Slot jumps park their row at the same spot under the section's sticky header. Put the
  // pointer there over an empty row first, so the next jump slides the populated row under it.
  await jumpToSlot(page, "gear.head");
  const box = await settledBox(page, "gear.head");
  const x = box.x + box.width - 8;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);

  await jumpToSlot(page, "gear.pants");
  // Chrome re-hit-tests the still pointer as rows scroll under it; `:hover` on the pants row
  // means its synthetic `mouseenter` has fired.
  await expect
    .poll(() =>
      slotRow(page, "gear.pants").evaluate((el) => el.matches(":hover")),
    )
    .toBe(true);
  await page.clock.runFor(1000);
  await expect(card(page)).toBeHidden();

  // A small move within the same row: no new `mouseenter`, but the card opens.
  await page.mouse.move(x + 3, y + 2);
  await expect(card(page).getByTestId("item-card-name")).toHaveText(PANTS_ITEM);
});
