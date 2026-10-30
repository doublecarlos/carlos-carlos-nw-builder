// An enabled layer is edited against the engine's own catalog when it folds on top, and
// against one composed for it when it sits lower. Either way its entries reach the list and
// its forms follow an undo.
import { test, expect, type Page } from "@playwright/test";
import { openBuilder, undoButton, setItemFilter } from "./support/app";
import { addLayer, layerRow } from "./support/nav";

const TOP_RING = "ZZZ Test Top Layer Ring";
const TOP_RENAMED = "ZZZ Test Top Layer Renamed";
const LOWER_RING = "ZZZ Test Lower Layer Ring";

async function selectLayer(page: Page, name: string) {
  await layerRow(page, name).locator(".nav-name").click();
  await expect(page.locator("strong").filter({ hasText: name })).toBeVisible();
}

async function createItem(page: Page, name: string) {
  await page.getByTestId("new-item").click();
  await page.getByTestId("item-name-input").fill(name);
  await setItemFilter(page, "gear_ring");
  await page.getByRole("button", { name: "Save item" }).click();
}

function listRow(page: Page, name: string) {
  return page.locator(".editor-row-name", { hasText: name });
}

test("an enabled top layer's item is listed and its form follows an undo", async ({
  page,
}) => {
  await openBuilder(page);
  await addLayer(page);
  await selectLayer(page, "Layer 1");
  await createItem(page, TOP_RING);

  await listRow(page, TOP_RING).first().click();
  const name = page.getByTestId("item-name-input");
  await expect(name).toHaveValue(TOP_RING);

  // The list row is the live edit arriving in the layer, so undo cannot fire ahead of it.
  await name.fill(TOP_RENAMED);
  await expect(listRow(page, TOP_RENAMED)).toBeVisible();
  await undoButton(page).click();
  await expect(name).toHaveValue(TOP_RING);
  await expect(listRow(page, TOP_RING)).toBeVisible();
});

test("a lower enabled layer lists its own item, and the top layer lists it too", async ({
  page,
}) => {
  await openBuilder(page);
  await addLayer(page);
  await addLayer(page);

  // New layers append below, so Layer 2 folds under Layer 1.
  await selectLayer(page, "Layer 2");
  await createItem(page, LOWER_RING);
  await listRow(page, LOWER_RING).first().click();
  await expect(page.getByTestId("item-name-input")).toHaveValue(LOWER_RING);

  await selectLayer(page, "Layer 1");
  await page.locator(".editor-search").fill(LOWER_RING);
  await expect(listRow(page, LOWER_RING)).toBeVisible();
});
