// Back over a dirty draft asks before anything moves: cancelling keeps the draft on screen and
// every history entry where it was.
import { test, expect, type Page } from "@playwright/test";
import { openBuilder } from "./support/app";
import { addLayer, confirmDialog, layerRow } from "./support/nav";

const DRAFT = "ZZZ Back Draft";
const param = (page: Page, key: string) =>
  new URL(page.url()).searchParams.get(key);

async function openLayerOnItem(page: Page) {
  await openBuilder(page);
  await addLayer(page);
  await layerRow(page, "Layer 1").locator(".nav-name").click();
  await page.locator(".editor-row").nth(3).click();
  await expect.poll(() => param(page, "item")).not.toBeNull();
  return page.url();
}

test.fixme("a cancelled Back to the previous entry keeps the new draft", async ({
  page,
}) => {
  const onItem = await openLayerOnItem(page);
  await page.getByTestId("new-item").click();
  await page.getByTestId("item-name-input").fill(DRAFT);

  await page.goBack();
  await expect(confirmDialog(page)).toBeVisible();
  await page.getByTestId("confirm-cancel").click();
  await expect(page.getByTestId("item-name-input")).toHaveValue(DRAFT);

  await page.goBack();
  await page.getByTestId("confirm-accept").click();
  await expect.poll(() => page.url()).toBe(onItem);
  await expect(page.getByTestId("item-name-input")).not.toHaveValue(DRAFT);
});

test("a cancelled Back to the previous build keeps the way back", async ({
  page,
}) => {
  await openBuilder(page);
  const build = page.url();
  await addLayer(page);
  await layerRow(page, "Layer 1").locator(".nav-name").click();
  await expect.poll(() => param(page, "layer")).not.toBeNull();
  const layer = page.url();
  await page.getByTestId("new-item").click();
  await page.getByTestId("item-name-input").fill(DRAFT);

  await page.goBack();
  await page.getByTestId("confirm-cancel").click();
  await expect.poll(() => page.url()).toBe(layer);
  await expect(page.getByTestId("item-name-input")).toHaveValue(DRAFT);

  await page.goBack();
  await page.getByTestId("confirm-accept").click();
  await expect.poll(() => page.url()).toBe(build);
});
