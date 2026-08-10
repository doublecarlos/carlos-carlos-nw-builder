// End-to-end coverage for dragging to reorder builds/layers in the sidebar (issue #182).
// The existing Move up/down buttons stay in place as the keyboard/screen-reader-accessible
// path -- see the last test in each section, a regression check that they still work.
import { test, expect } from "@playwright/test";
import { openBuilder } from "./support/app";
import { buildRow, layerRow, addBuild, addLayer, moveUp } from "./support/nav";
import { dragOnto } from "./support/dragDrop";

test("dragging a build row onto another reorders the build list", async ({
  page,
}) => {
  await openBuilder(page);
  await addBuild(page);
  await addBuild(page);
  await expect(buildRow(page, "Build 3")).toBeVisible();

  // Drag Build 1's handle onto Build 3 -- lands right after it.
  await dragOnto(
    buildRow(page, "Build 1").getByTestId("build-drag-handle"),
    buildRow(page, "Build 3"),
  );

  const rows = page.locator(".nav-row--build");
  await expect(rows.nth(0)).toContainText("Build 2");
  await expect(rows.nth(1)).toContainText("Build 3");
  await expect(rows.nth(2)).toContainText("Build 1");
});

test("build drag order survives a reload", async ({ page }) => {
  await openBuilder(page);
  await addBuild(page);

  await dragOnto(
    buildRow(page, "Build 1").getByTestId("build-drag-handle"),
    buildRow(page, "Build 2"),
  );
  await expect(page.locator(".nav-row--build").nth(0)).toContainText("Build 2");

  // eslint-disable-next-line playwright/no-wait-for-timeout -- No DOM event to observe for IDB flush
  await page.waitForTimeout(500);
  await page.reload();
  await page.getByTestId("library").waitFor({ state: "visible" });

  const rows = page.locator(".nav-row--build");
  await expect(rows.nth(0)).toContainText("Build 2");
  await expect(rows.nth(1)).toContainText("Build 1");
});

test("Move up still reorders builds after drag-and-drop is wired in", async ({
  page,
}) => {
  await openBuilder(page);
  await addBuild(page);
  await expect(buildRow(page, "Build 2")).toBeVisible();

  await moveUp(buildRow(page, "Build 2"));

  const rows = page.locator(".nav-row--build");
  await expect(rows.nth(0)).toContainText("Build 2");
  await expect(rows.nth(1)).toContainText("Build 1");
});

test("dragging a layer row onto another reorders the layer list", async ({
  page,
}) => {
  await openBuilder(page);
  await addLayer(page);
  await addLayer(page);
  await expect(layerRow(page, "Layer 2")).toBeVisible();

  // Drag Layer 1's handle onto Layer 2 -- lands right after it.
  await dragOnto(
    layerRow(page, "Layer 1").getByTestId("layer-drag-handle"),
    layerRow(page, "Layer 2"),
  );

  const rows = page.locator(".nav-row--layer");
  await expect(rows.nth(0)).toContainText("Layer 2");
  await expect(rows.nth(1)).toContainText("Layer 1");
});

test("Move up still reorders layers after drag-and-drop is wired in", async ({
  page,
}) => {
  await openBuilder(page);
  await addLayer(page);
  await addLayer(page);

  await moveUp(layerRow(page, "Layer 2"));

  const rows = page.locator(".nav-row--layer");
  await expect(rows.nth(0)).toContainText("Layer 2");
});
