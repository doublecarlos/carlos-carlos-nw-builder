// End-to-end coverage for dragging to reorder builds/layers in the sidebar.
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
import { beginDrag, dragOnto, dropAt, requireBox } from "./support/dragDrop";

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
  const fromAfterBuild1 = await dropIndicators(page).boundingBox();

  await drag.over(buildRow(page, "Build 2"), "before");
  await expect(dropIndicators(page)).toHaveCount(1);
  const fromBeforeBuild2 = await dropIndicators(page).boundingBox();

  expect(fromBeforeBuild2?.y).toBe(fromAfterBuild1?.y);

  await drag.end();
});

test("dropping in the gap between two rows lands between them", async ({
  page,
}) => {
  await openBuilder(page);
  await addBuild(page);
  await addBuild(page);
  await expect(buildRow(page, "Build 3")).toBeVisible();

  const build1Box = await requireBox(buildRow(page, "Build 1"));
  const build2Box = await requireBox(buildRow(page, "Build 2"));
  const gapX = build1Box.x + 4;
  const gapY = build1Box.y + build1Box.height + 2;
  expect(gapY).toBeLessThan(build2Box.y + build2Box.height);

  await beginDrag(buildRow(page, "Build 3"));
  await dropAt(page, gapX, gapY);

  const rows = page.locator(".nav-row--build");
  await expect(rows.nth(0)).toContainText("Build 1");
  await expect(rows.nth(1)).toContainText("Build 3");
  await expect(rows.nth(2)).toContainText("Build 2");
});

test("dropping below the last row appends", async ({ page }) => {
  await openBuilder(page);
  await addBuild(page);
  await addBuild(page);
  await expect(buildRow(page, "Build 3")).toBeVisible();

  const lastRowBox = await requireBox(buildRow(page, "Build 3"));

  await beginDrag(buildRow(page, "Build 1"));
  await dropAt(
    page,
    lastRowBox.x + lastRowBox.width / 2,
    lastRowBox.y + lastRowBox.height + 20,
  );

  const rows = page.locator(".nav-row--build");
  await expect(rows.nth(0)).toContainText("Build 2");
  await expect(rows.nth(1)).toContainText("Build 3");
  await expect(rows.nth(2)).toContainText("Build 1");
});

test("the drop indicator disappears once the pointer leaves every list", async ({
  page,
}) => {
  await openBuilder(page);
  await addBuild(page);
  await addBuild(page);

  const drag = await beginDrag(buildRow(page, "Build 1"));
  await drag.over(buildRow(page, "Build 3"));
  await expect(dropIndicators(page)).toHaveCount(1);

  await drag.over(page.getByText("Builds", { exact: true }));
  await expect(dropIndicators(page)).toHaveCount(0);

  await drag.end();
});

test("Escape mid-drag cancels: order is unchanged and the indicator hides", async ({
  page,
}) => {
  await openBuilder(page);
  await addBuild(page);
  await addBuild(page);
  await expect(buildRow(page, "Build 3")).toBeVisible();

  const drag = await beginDrag(buildRow(page, "Build 1"));
  await drag.over(buildRow(page, "Build 3"));
  await expect(dropIndicators(page)).toHaveCount(1);

  await drag.end();

  await expect(dropIndicators(page)).toHaveCount(0);
  const rows = page.locator(".nav-row--build");
  await expect(rows.nth(0)).toContainText("Build 1");
  await expect(rows.nth(1)).toContainText("Build 2");
  await expect(rows.nth(2)).toContainText("Build 3");
});

test("a plain click on a build row still selects it, and so does a small wiggle", async ({
  page,
}) => {
  await openBuilder(page);
  await addBuild(page);

  await buildRow(page, "Build 1").click();
  await expect(buildRow(page, "Build 1")).toHaveClass(/is-active/);

  // A couple of px of jitter stays under useDragHandle's move threshold, so this is a click.
  const box = await requireBox(buildRow(page, "Build 2"));
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 2, y, { steps: 1 });
  await page.mouse.up();

  await expect(buildRow(page, "Build 2")).toHaveClass(/is-active/);
});

test("dragging autoscrolls the builds list when held near its bottom edge", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 500 });
  await openBuilder(page);
  for (let i = 0; i < 30; i++) await addBuild(page);
  const lastRow = buildRow(page, "Build 30");
  await expect(lastRow).toBeAttached();

  const list = page.getByTestId("nav-builds-list");
  const listBox = await requireBox(list);
  const scrollTopBefore = await list.evaluate((el) => el.scrollTop);

  // "Build 1" would also match "Build 10".."Build 19", so pin the exact name.
  const firstRow = page
    .locator(".nav-row--build")
    .filter({ hasText: /^Build 1$/ });
  const drag = await beginDrag(firstRow);
  await page.mouse.move(
    listBox.x + listBox.width / 2,
    listBox.y + listBox.height - 8,
    { steps: 2 },
  );

  await expect(async () => {
    const scrollTop = await list.evaluate((el) => el.scrollTop);
    expect(scrollTop).toBeGreaterThan(scrollTopBefore);
  }).toPass();

  await drag.end();
});
