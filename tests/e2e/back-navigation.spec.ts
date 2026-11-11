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

test("a cancelled Back to the previous entry keeps the new draft", async ({
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

test("a cancelled Back keeps the way back to the build", async ({ page }) => {
  await openBuilder(page);
  const build = page.url();
  await addLayer(page);
  await layerRow(page, "Layer 1").locator(".nav-name").click();
  await expect.poll(() => param(page, "layer")).not.toBeNull();
  const layer = page.url();
  await page.getByTestId("new-item").click();
  await expect.poll(() => param(page, "new")).toBe("items");
  const draft = page.url();
  await page.getByTestId("item-name-input").fill(DRAFT);

  await page.goBack();
  await page.getByTestId("confirm-cancel").click();
  await expect.poll(() => page.url()).toBe(draft);
  await expect(page.getByTestId("item-name-input")).toHaveValue(DRAFT);

  await page.goBack();
  await page.getByTestId("confirm-accept").click();
  await expect.poll(() => page.url()).toBe(layer);
  await page.goBack();
  await expect.poll(() => page.url()).toBe(build);
});

test("Back undoes a switch of the details tab", async ({ page }) => {
  // The tab is a place in the URL like the editor's own tabs, so Back returns to the one
  // before rather than leaving the build.
  await openBuilder(page);
  const build = page.url();
  const sidebar = page.getByTestId("details-sidebar");
  const bonusesTab = sidebar.getByRole("button", { name: /^Bonuses/ });
  await bonusesTab.click();
  await expect.poll(() => param(page, "tab")).toBe("bonuses");

  await page.goBack();
  await expect(bonusesTab).toHaveAttribute("aria-pressed", "false");
  await expect.poll(() => page.url()).toBe(build);
});
