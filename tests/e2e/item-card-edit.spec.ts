// The hover card's edit button: the same jump Ctrl/Cmd+click on the row makes, without a
// modifier, and a tooltip naming the layer it lands in.
import { test, expect, type Page } from "@playwright/test";
import { openBuilder, slotRow, chooseItem, hoverForCard } from "./support/app";
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
