// A jump into the layer editor shows its entry in the list: the row scrolls into view and takes
// focus, and only the filters hiding it are cleared, with a notice saying so.
import { test, expect, type Page } from "@playwright/test";
import { chooseItem, openBuilder, slotRow } from "./support/app";
import { shippedItemName } from "./support/shippedData";
import { addLayer, buildRow, layerRow } from "./support/nav";

const SLOT_ID = "gear.head";
const HEAD_ITEM = shippedItemName("m29-enchanted-depthweave-cap-ca");

const currentRow = (page: Page) =>
  page.locator('.editor-row[aria-current="true"]');

async function jumpToHeadItem(page: Page) {
  await buildRow(page, "Build 1").locator(".nav-name").click();
  await chooseItem(page, SLOT_ID, HEAD_ITEM);
  await slotRow(page, SLOT_ID).click({ modifiers: ["ControlOrMeta"] });
  await expect(page.getByTestId("item-name-input")).toHaveValue(HEAD_ITEM);
}

test("Ctrl+click on a build row shows its item in the list, focused", async ({
  page,
}) => {
  await openBuilder(page);
  await jumpToHeadItem(page);

  await expect(currentRow(page)).toHaveText(new RegExp(HEAD_ITEM));
  await expect(currentRow(page)).toBeInViewport();
  await expect(currentRow(page)).toBeFocused();
});

test("a jump clears the search hiding its entry and says so", async ({
  page,
}) => {
  await openBuilder(page);
  await addLayer(page);
  await layerRow(page, "Layer 1").locator(".nav-name").click();
  await page.locator(".editor-search").fill("zzz nothing matches");
  await expect(page.locator(".editor-row")).toHaveCount(0);

  await jumpToHeadItem(page);
  await expect(page.locator(".editor-search")).toHaveValue("");
  await expect(currentRow(page)).toBeInViewport();
  await expect(page.getByText(/Cleared the search/)).toBeVisible();
});

test("a jump into the Slots outline clears the search hiding its slot", async ({
  page,
}) => {
  await openBuilder(page);
  await addLayer(page);
  await layerRow(page, "Layer 1").locator(".nav-name").click();
  await page.getByTestId("tab-slots").click();
  await page.locator(".outline-section").first().click();
  const link = page
    .getByTestId("section-slot-list")
    .getByRole("button")
    .first();
  const name = await link.textContent();
  await page.locator(".editor-search").fill("zzz nothing matches");

  await link.click();
  await expect(page.locator(".editor-search")).toHaveValue("");
  const current = page.locator(
    '[data-testid="slot-outline"] [aria-current="true"]',
  );
  await expect(current).toContainText(name ?? "");
  await expect(current).toBeInViewport();
  await expect(current).toBeFocused();
});
