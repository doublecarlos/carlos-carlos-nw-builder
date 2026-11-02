// Pinning the build editor's item card: from its header's pin button or from a row's info
// button, a pinned card stays put through hovering other rows and leaving it, until it is
// closed on purpose.
import { test, expect, type Page } from "@playwright/test";
import {
  openBuilder,
  slotRow,
  chooseItem,
  hoverForCard,
  pickerInput,
} from "./support/app";
import { importTestCatalog } from "./support/testCatalog";

const SHIRT_ITEM = "Test Pin Shirt";
const PANTS_ITEM = "Test Pin Pants";

/** The shared hover card, teleported to `<body>` by BasePopover. */
function card(page: Page) {
  return page.locator(".itemcard");
}

/** Two rows holding an item each, so hovering the second would normally swap the card. */
async function setUp(page: Page) {
  await page.clock.install();
  await openBuilder(page);
  await importTestCatalog(page, {
    items: [
      { id: "test-pin-shirt", name: SHIRT_ITEM, filter: "gear_shirt" },
      { id: "test-pin-pants", name: PANTS_ITEM, filter: "gear_pants" },
    ],
  });
  await chooseItem(page, "gear.shirt", SHIRT_ITEM);
  await chooseItem(page, "gear.pants", PANTS_ITEM);
}

/** Hovers a row and lets the card's opening delay pass. */
async function hoverRow(page: Page, slotId: string) {
  await slotRow(page, slotId).hover();
  await page.clock.runFor(1000);
}

test("a row's info button shows only while the row is hovered", async ({
  page,
}) => {
  // A long list would otherwise carry an icon on every line.
  await setUp(page);
  const info = page.getByTestId("slot-info:gear.shirt");
  await expect(info).toBeHidden();

  await hoverForCard(page, slotRow(page, "gear.shirt"));
  await expect(info).toBeVisible();
});

test("the info button opens the card pinned, and other rows leave it alone", async ({
  page,
}) => {
  await setUp(page);
  await hoverForCard(page, slotRow(page, "gear.shirt"));
  await page.getByTestId("slot-info:gear.shirt").click();
  await expect(card(page).getByTestId("item-card-name")).toHaveText(SHIRT_ITEM);
  await expect(card(page).getByTestId("card-close")).toBeVisible();

  await hoverRow(page, "gear.pants");
  await expect(card(page)).toHaveCount(1);
  await expect(card(page).getByTestId("item-card-name")).toHaveText(SHIRT_ITEM);

  await card(page).getByTestId("card-close").click();
  await expect(card(page)).toBeHidden();
});

test("the hover card's pin button keeps it open after the pointer leaves", async ({
  page,
}) => {
  await setUp(page);
  await hoverForCard(page, slotRow(page, "gear.shirt"));
  await page.clock.runFor(1000);
  await card(page).getByTestId("card-pin").click();

  await page.mouse.move(0, 0);
  await page.clock.runFor(1000);
  await expect(card(page)).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(card(page)).toBeHidden();
});

test("a pinned card steps aside while a picker is open and comes back once it closes", async ({
  page,
}) => {
  // Over an open menu it would block the options and crowd the picker's own preview card.
  await setUp(page);
  await hoverForCard(page, slotRow(page, "gear.shirt"));
  await page.getByTestId("slot-info:gear.shirt").click();
  const pinnedName = page
    .getByTestId("item-card-name")
    .filter({ hasText: SHIRT_ITEM });
  await expect(pinnedName).toBeVisible();

  await pickerInput(slotRow(page, "gear.pants")).click();
  await expect(page.getByTestId("picker-menu")).toBeVisible();
  await expect(pinnedName).toHaveCount(0);

  // Escape belongs to the picker here, so the pinned card survives it.
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("picker-menu")).toHaveCount(0);
  await expect(pinnedName).toBeVisible();
});
