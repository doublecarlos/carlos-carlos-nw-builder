// End-to-end coverage for dragging to reorder builds/layers in the sidebar (issue #182).
// Ctrl+↑/↓ stays in place as the keyboard/screen-reader-accessible reorder path (the old
// Move up/down buttons were retired once this shortcut covered the same ground) -- see the
// last test in each section, a regression check that it still works.
import { test, expect } from "@playwright/test";
import { openBuilder } from "./support/app";
import {
  buildRow,
  layerRow,
  addBuild,
  addLayer,
  moveUp,
  dropIndicators,
} from "./support/nav";
import { beginDrag, dragOnto } from "./support/dragDrop";

test("dragging a build row onto another reorders the build list", async ({
  page,
}) => {
  await openBuilder(page);
  await addBuild(page);
  await addBuild(page);
  await expect(buildRow(page, "Build 3")).toBeVisible();

  // Drag Build 1 onto Build 3 -- lands right after it.
  await dragOnto(buildRow(page, "Build 1"), buildRow(page, "Build 3"));

  const rows = page.locator(".nav-row--build");
  await expect(rows.nth(0)).toContainText("Build 2");
  await expect(rows.nth(1)).toContainText("Build 3");
  await expect(rows.nth(2)).toContainText("Build 1");
});

test("build drag order survives a reload", async ({ page }) => {
  await openBuilder(page);
  await addBuild(page);

  await dragOnto(buildRow(page, "Build 1"), buildRow(page, "Build 2"));
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

  // Drag Layer 1 onto Layer 2 -- lands right after it.
  await dragOnto(layerRow(page, "Layer 1"), layerRow(page, "Layer 2"));

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

test("both halves of a gap between builds are one drop position", async ({
  page,
}) => {
  await openBuilder(page);
  await addBuild(page);
  await addBuild(page);
  await expect(buildRow(page, "Build 3")).toBeVisible();

  const drag = await beginDrag(buildRow(page, "Build 3"));

  // Below Build 1 and above Build 2 are the same place, so they light the same single line
  // rather than one each.
  await drag.over(buildRow(page, "Build 1"), "after");
  await expect(dropIndicators(page)).toHaveCount(1);
  await expect(dropIndicators(page)).toContainText("Build 2");

  await drag.over(buildRow(page, "Build 2"), "before");
  await expect(dropIndicators(page)).toHaveCount(1);
  await expect(dropIndicators(page)).toContainText("Build 2");

  await drag.end();
});
