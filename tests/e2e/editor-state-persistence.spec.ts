// Switching between the build editor and the layer editor (via the nav) unmounts one and
// mounts the other. Coverage for the state that must survive that round trip anyway: the
// build editor's scroll position, and the layer editor's active tab/search/selection.
import { test, expect } from "@playwright/test";
import { openBuilder } from "./support/app";
import { addLayer, layerRow } from "./support/nav";

const HEAD_ITEM = "M29 Enchanted Depthweave Cap";

/** Clicks the first build row in the library, switching back from the layer editor. */
async function switchToBuild(page: import("@playwright/test").Page) {
  const build = page.getByTestId("library").locator(".nav-row--build").first();
  await build.locator(".nav-name").click();
  await expect(page.getByTestId("builder-content")).toBeVisible();
}

test("build editor keeps its scroll position after switching to a layer and back", async ({
  page,
}) => {
  await openBuilder(page);
  // Expand every section so the column has enough rows to actually scroll.
  await page.getByRole("button", { name: /expand all/i }).click();

  const scrollEl = page.getByTestId("editor-column");
  await scrollEl.evaluate((el) => {
    el.scrollTop = 600;
  });
  const scrolledTo = await scrollEl.evaluate((el) => el.scrollTop);
  expect(scrolledTo).toBeGreaterThan(0);

  await addLayer(page);
  await layerRow(page, "Layer 1").locator(".nav-name").click();
  await switchToBuild(page);

  await expect
    .poll(() => scrollEl.evaluate((el) => el.scrollTop))
    .toBe(scrolledTo);
});

test("layer editor keeps its search query and selected item after switching to the build editor and back", async ({
  page,
}) => {
  await openBuilder(page);
  await addLayer(page);
  const layer = layerRow(page, "Layer 1");
  await layer.locator(".nav-name").click();

  const searchBox = page.locator(".editor-search");
  await searchBox.fill(HEAD_ITEM);
  await page.locator(".editor-row", { hasText: HEAD_ITEM }).click();
  await expect(page.getByTestId("item-name-input")).toHaveValue(HEAD_ITEM);

  await switchToBuild(page);
  await layer.locator(".nav-name").click();

  await expect(page.locator(".editor-search")).toHaveValue(HEAD_ITEM);
  await expect(page.getByTestId("item-name-input")).toHaveValue(HEAD_ITEM);
});

test("layer editor keeps its active tab after switching to the build editor and back", async ({
  page,
}) => {
  await openBuilder(page);
  await addLayer(page);
  const layer = layerRow(page, "Layer 1");
  await layer.locator(".nav-name").click();

  await page.getByRole("button", { name: /Bonuses \d+/ }).click();
  await expect(page.getByTestId("new-bonus")).toBeVisible();

  await switchToBuild(page);
  await layer.locator(".nav-name").click();

  await expect(page.getByTestId("new-bonus")).toBeVisible();
});
