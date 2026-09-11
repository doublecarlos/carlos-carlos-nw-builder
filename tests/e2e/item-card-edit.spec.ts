// The hover card's actions: the edit button, which makes the same jump Ctrl/Cmd+click on the
// row makes without a modifier and names the layer it lands in, and the links that park the
// cursor on another row the card names.
import { test, expect, type Page } from "@playwright/test";
import {
  openBuilder,
  slotRow,
  cursorRow,
  chooseItem,
  hoverForCard,
} from "./support/app";
import { shippedItemName } from "./support/shippedData";
import { addLayer, layerRow, renameViaSidebar } from "./support/nav";

const SLOT_ID = "gear.head";
const HEAD_ITEM = shippedItemName("m29-enchanted-depthweave-cap-ca");

/** The shared hover card, teleported to `<body>` by BasePopover. */
function card(page: Page) {
  return page.locator(".itemcard");
}

/** Leaves the pointer inside the card, so the button stays reachable without it closing. */
async function openCardForHead(page: Page) {
  await openBuilder(page);
  await chooseItem(page, SLOT_ID, HEAD_ITEM);
  await hoverForCard(page, slotRow(page, SLOT_ID));
  await expect(card(page).getByTestId("item-card-name")).toHaveText(HEAD_ITEM);
}

test("the card's edit button opens the hovered item in a layer, no modifier needed", async ({
  page,
}) => {
  await openCardForHead(page);
  await card(page).getByTestId("item-card-edit").click();

  await expect(
    page.locator("strong").filter({ hasText: "Layer 1" }),
  ).toBeVisible();
  await expect(page.getByTestId("item-name-input")).toHaveValue(HEAD_ITEM);
});

test("the card closes when its edit button navigates away", async ({
  page,
}) => {
  await openCardForHead(page);
  await card(page).getByTestId("item-card-edit").click();
  await expect(card(page)).toBeHidden();
});

test("the edit button names a new layer when there is none to target", async ({
  page,
}) => {
  await openCardForHead(page);
  await expect(card(page).getByTestId("item-card-edit")).toHaveAttribute(
    "aria-label",
    /Edit this item in a new layer \((Ctrl|Cmd)\+Click the row\)/,
  );
});

test("the edit button names the layer the edit would land in", async ({
  page,
}) => {
  await openBuilder(page);
  await chooseItem(page, SLOT_ID, HEAD_ITEM);
  await addLayer(page);
  await renameViaSidebar(page, layerRow(page, "Layer 1"), "Tuning");

  await page.getByTestId("library").locator(".nav-row--build").first().click();
  await hoverForCard(page, slotRow(page, SLOT_ID));
  await expect(card(page).getByTestId("item-card-edit")).toHaveAttribute(
    "aria-label",
    /Edit this item in “Tuning”/,
  );
});

// A two-piece set: shirt and pants share one bonus, credited to the shirt as the first
// source, so the pants card points back at it.
const SHIRT_ITEM = shippedItemName("m31-bloodwoven-signs-damage");
const PANTS_ITEM = shippedItemName("m31-bloodwoven-sigils-ca");

test("the card's link to a shared bonus's first source parks the cursor on that row", async ({
  page,
}) => {
  await openBuilder(page);
  await chooseItem(page, "gear.shirt", SHIRT_ITEM);
  await chooseItem(page, "gear.pants", PANTS_ITEM);
  await hoverForCard(page, slotRow(page, "gear.pants"));
  const link = card(page).getByTestId("item-card-first-source");
  await expect(link).toHaveText(SHIRT_ITEM);

  await link.click();

  await expect(cursorRow(page)).toHaveAttribute(
    "data-cursor-key",
    "slot:gear.shirt",
  );
  await expect(card(page)).toBeHidden();
});
