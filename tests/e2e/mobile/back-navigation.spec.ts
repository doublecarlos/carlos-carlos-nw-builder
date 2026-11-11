// Back and Forward on a phone move between places: builds, layers, a layer's list and its open
// entry, the editor and stats panes. Each place a user moved to is one Back away, a vetoed Back
// keeps every entry, and Forward returns to where Back left.
import { test, expect, type Page } from "@playwright/test";
import { openBuilder } from "../support/app";
import { addLayer, openDrawer } from "../support/nav";

const list = (page: Page) => page.getByTestId("layer-entries-column");
const form = (page: Page) => page.getByTestId("layer-form-pane");
const param = (page: Page, key: string) =>
  new URL(page.url()).searchParams.get(key);

/** Opens a new layer from a build. Returns the build's URL, the entry before the layer's. */
async function openLayer(page: Page) {
  await openBuilder(page);
  const before = page.url();
  await openDrawer(page);
  await addLayer(page);
  await expect(list(page)).toBeVisible();
  await expect.poll(() => page.url()).not.toBe(before);
  return { before, layer: page.url() };
}

test("Forward after Back from a form opens the form again", async ({
  page,
}) => {
  await openLayer(page);
  await page.locator(".editor-row").nth(3).tap();
  await expect(form(page)).toBeVisible();
  const item = param(page, "item");

  await page.goBack();
  await expect(list(page)).toBeVisible();
  await page.goForward();
  await expect(form(page)).toBeVisible();
  expect(param(page, "item")).toBe(item);
});

test("Back from an entry a form linked to returns to that form", async ({
  page,
}) => {
  await openLayer(page);
  await page.locator(".editor-row").nth(3).tap();
  const item = param(page, "item");
  await page.getByTestId("edit-filter-link").tap();
  await expect.poll(() => param(page, "filter")).not.toBeNull();

  await page.goBack();
  await expect(form(page)).toBeVisible();
  await expect.poll(() => param(page, "item")).toBe(item);
});

test("a cancelled Back over a dirty draft keeps the form and the way back", async ({
  page,
}) => {
  const { before, layer } = await openLayer(page);
  await page.getByTestId("new-item").tap();
  await page.getByTestId("item-name-input").fill("ZZZ Back Draft");

  await page.goBack();
  await page.getByTestId("confirm-cancel").tap();
  await expect(page.getByTestId("item-name-input")).toHaveValue(
    "ZZZ Back Draft",
  );

  await page.goBack();
  await page.getByTestId("confirm-accept").tap();
  await expect(list(page)).toBeVisible();
  await expect.poll(() => page.url()).toBe(layer);
  await page.goBack();
  await expect.poll(() => page.url()).toBe(before);
});

test("Back from the stats pane returns to the editor pane", async ({
  page,
}) => {
  await openBuilder(page);
  const build = param(page, "build");
  await page.getByTestId("pane-stats").click();
  await expect(page.getByTestId("stat-panel-column")).toBeVisible();

  await page.goBack();
  await expect(page.getByTestId("editor-pane")).toBeVisible();
  expect(param(page, "build")).toBe(build);
});

test("a reload keeps the open form", async ({ page }) => {
  await openLayer(page);
  await page.locator(".editor-row").nth(3).tap();
  await expect(form(page)).toBeVisible();
  await page.reload();
  await expect(form(page)).toBeVisible();
});

test("a reload keeps the stats pane", async ({ page }) => {
  await openBuilder(page);
  await page.getByTestId("pane-stats").click();
  await expect(page.getByTestId("stat-panel-column")).toBeVisible();
  await page.reload();
  await expect(page.getByTestId("stat-panel-column")).toBeVisible();
});

test("Back from a form returns to its row, where the list was", async ({
  page,
}) => {
  // The list unmounts while a form fills the pane; Back brings it back scrolled as it was,
  // with the row that was open still marked and in view.
  await openLayer(page);
  const scroller = list(page).locator(".overflow-y-auto").last();
  const rows = page.locator(".editor-row");
  await rows.nth(40).scrollIntoViewIfNeeded();
  const row = rows.nth(40);
  const name = await row.locator(".editor-row-name").textContent();
  await row.tap();
  await expect(form(page)).toBeVisible();

  await page.goBack();
  const current = page.locator('.editor-row[aria-current="true"]');
  await expect(current).toContainText(name ?? "");
  await expect(current).toBeInViewport();
  expect(await scroller.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
});
