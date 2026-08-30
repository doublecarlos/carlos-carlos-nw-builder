// End-to-end coverage for Nav.vue's sidebar: builds, customization layers, recently
// deleted, filtering, ordering, and the layer checkbox.
import { test, expect, type Locator } from "@playwright/test";
import { openBuilder } from "./support/app";
import {
  buildRow,
  folderRow,
  layerRow,
  openRowMenu,
  confirmDangerAction,
  renameViaSidebar,
  addBuild,
  addFolder,
  addLayer,
  filterBuilds,
  filterLayers,
  moveUp,
  recentlyDeletedHeader,
} from "./support/nav";

// --- Builds -------------------------------------------------------------------------

test("+ New under Builds appends and selects", async ({ page }) => {
  await openBuilder(page);
  await addBuild(page);

  const created = buildRow(page, "Build 2");
  await expect(created).toBeVisible();
  await expect(created).toHaveClass(/is-active/);
});

test("renaming a build via double-click updates the sidebar", async ({
  page,
}) => {
  await openBuilder(page);
  const row = buildRow(page, "Build 1");
  await renameViaSidebar(page, row, "My Warlock");

  await expect(buildRow(page, "My Warlock")).toBeVisible();
});

test("renaming a build via the kebab menu commits on Enter", async ({
  page,
}) => {
  await openBuilder(page);
  const row = buildRow(page, "Build 1");
  const menu = await openRowMenu(row);
  await menu.getByRole("button", { name: "Rename" }).click();

  const input = page.locator(".nav-rename");
  await input.fill("My Cleric");
  await input.press("Enter");

  await expect(buildRow(page, "My Cleric")).toBeVisible();
});

test("rename input auto-focuses and selects all text", async ({ page }) => {
  await openBuilder(page);
  const row = buildRow(page, "Build 1");

  // Start rename via double-click.
  await row.locator(".nav-name").dblclick();

  const input = page.locator(".nav-rename");
  await expect(input).toBeFocused();

  // Type a character without clearing first - the existing text was selected,
  // so the character replaces it entirely.
  await input.press("x");
  await expect(input).toHaveValue("x");
});

test("the filter box narrows the build list and clearing it restores every row", async ({
  page,
}) => {
  await openBuilder(page);
  // Create a second build so there's more than one to filter.
  await addBuild(page);
  await expect(buildRow(page, "Build 2")).toBeVisible();

  await filterBuilds(page, "Build 1");
  await expect(buildRow(page, "Build 1")).toBeVisible();
  await expect(buildRow(page, "Build 2")).toHaveCount(0);

  // Clear the filter.
  await filterBuilds(page, "");
  await expect(buildRow(page, "Build 1")).toBeVisible();
  await expect(buildRow(page, "Build 2")).toBeVisible();
});

test("the filter box matches multiple whitespace-separated words in any order", async ({
  page,
}) => {
  await openBuilder(page);
  await renameViaSidebar(page, buildRow(page, "Build 1"), "Celestial Amethyst");
  await addBuild(page);

  await filterBuilds(page, "ame cel");
  await expect(buildRow(page, "Celestial Amethyst")).toBeVisible();
  await expect(buildRow(page, "Build 2")).toHaveCount(0);
});

test("Move up reorders the build list", async ({ page }) => {
  await openBuilder(page);
  await addBuild(page);
  await expect(buildRow(page, "Build 2")).toBeVisible();

  // Move Build 2 up so it comes first.
  await moveUp(buildRow(page, "Build 2"));

  // After move-up, Build 2 should be the first row.
  const buildRows = page.locator(".nav-row--build");
  await expect(buildRows.nth(0)).toContainText("Build 2");
  await expect(buildRows.nth(1)).toContainText("Build 1");
});

test("Move up order survives a reload", async ({ page }) => {
  await openBuilder(page);
  await addBuild(page);

  await moveUp(buildRow(page, "Build 2"));

  // Wait for IDB write to complete before reload.
  // eslint-disable-next-line playwright/no-wait-for-timeout -- No DOM event to observe for IDB flush
  await page.waitForTimeout(500);

  await page.reload();
  await page.getByTestId("library").waitFor({ state: "visible" });

  const buildRows = page.locator(".nav-row--build");
  await expect(buildRows.nth(0)).toContainText("Build 2");
  await expect(buildRows.nth(1)).toContainText("Build 1");
});

test("Ctrl+ArrowDown does nothing for the last build", async ({ page }) => {
  await openBuilder(page);
  await addBuild(page);
  await expect(buildRow(page, "Build 2")).toBeVisible();

  await buildRow(page, "Build 2").locator(".nav-name").focus();
  await page.keyboard.press("Control+ArrowDown");

  const buildRows = page.locator(".nav-row--build");
  await expect(buildRows.nth(0)).toContainText("Build 1");
  await expect(buildRows.nth(1)).toContainText("Build 2");
});

test("Delete moves the build into Recently deleted; Restore puts it back", async ({
  page,
}) => {
  await openBuilder(page);
  await addBuild(page);
  await expect(buildRow(page, "Build 2")).toBeVisible();

  // Delete Build 2.
  const menu = await openRowMenu(buildRow(page, "Build 2"));
  await confirmDangerAction(menu, "Delete");

  // Build 2 should be gone from the build list.
  await expect(buildRow(page, "Build 2")).toHaveCount(0);

  // Recently deleted section should appear.
  const trash = recentlyDeletedHeader(page);
  await expect(trash).toBeVisible();

  // Expand the section and restore.
  await trash.click();
  // Click the first Restore button in the trash section.
  await page
    .locator("text=Recently deleted")
    .locator("..")
    .locator("..")
    .getByRole("button", { name: "Restore" })
    .first()
    .click();

  // Build 2 should be back.
  await expect(buildRow(page, "Build 2")).toBeVisible();
});

test("Delete permanently needs two clicks and the row does not come back after reload", async ({
  page,
}) => {
  await openBuilder(page);
  // Delete the first build so we can test permanent delete.
  // Create a second build first so deletion is allowed.
  await addBuild(page);
  await expect(buildRow(page, "Build 2")).toBeVisible();

  // Delete Build 2 (moves to trash).
  {
    const menu = await openRowMenu(buildRow(page, "Build 2"));
    await confirmDangerAction(menu, "Delete");
  }

  // Expand Recently deleted.
  const trash = recentlyDeletedHeader(page);
  await trash.click();

  // Open the trash kebab menu and click "Delete permanently".
  const trashMenu = await openRowMenu(
    page
      .locator("text=Recently deleted")
      .locator("..")
      .locator("..")
      .locator(".nav-row")
      .first(),
  );
  await confirmDangerAction(trashMenu, "Delete permanently");

  // Reload.
  await page.reload();

  // Build 2 should not be back.
  await expect(buildRow(page, "Build 2")).toHaveCount(0);
});

// --- Layers -------------------------------------------------------------------------

test("+ New under Layers creates Layer 1; a second gives Layer 2", async ({
  page,
}) => {
  await openBuilder(page);
  await addLayer(page);

  const first = layerRow(page, "Layer 1");
  await expect(first).toBeVisible();
  await expect(first).toHaveClass(/is-active/);

  await addLayer(page);
  const second = layerRow(page, "Layer 2");
  await expect(second).toBeVisible();
  await expect(second).toHaveClass(/is-active/);
});

test("unchecking a layer checkbox does not change which panel the editor area shows", async ({
  page,
}) => {
  await openBuilder(page);
  await addLayer(page);
  const row = layerRow(page, "Layer 1");
  await expect(row).toHaveClass(/is-active/);

  // Toggle the checkbox off - the layer should stay selected.
  const checkbox = row.locator('input[type="checkbox"]');
  await checkbox.click();

  // The layer row should still be active.
  await expect(row).toHaveClass(/is-active/);
});

test("the layer filter narrows the list and clearing it restores every row", async ({
  page,
}) => {
  await openBuilder(page);
  await addLayer(page);
  await addLayer(page);
  await expect(layerRow(page, "Layer 1")).toBeVisible();
  await expect(layerRow(page, "Layer 2")).toBeVisible();

  await filterLayers(page, "Layer 1");
  await expect(layerRow(page, "Layer 1")).toBeVisible();
  await expect(layerRow(page, "Layer 2")).toHaveCount(0);

  await filterLayers(page, "");
  await expect(layerRow(page, "Layer 1")).toBeVisible();
  await expect(layerRow(page, "Layer 2")).toBeVisible();
});

test("Move up reorders layers and Ctrl+ArrowUp does nothing at the top", async ({
  page,
}) => {
  await openBuilder(page);
  await addLayer(page);
  await addLayer(page);

  // Ctrl+ArrowUp should do nothing for the first layer -- there's no neighbour above it.
  {
    await layerRow(page, "Layer 1").locator(".nav-name").focus();
    await page.keyboard.press("Control+ArrowUp");
    const layerRows = page.locator(".nav-row--layer");
    await expect(layerRows.nth(0)).toContainText("Layer 1");
  }

  // Move up on Layer 2 so it becomes first.
  await moveUp(layerRow(page, "Layer 2"));

  const layerRows = page.locator(".nav-row--layer");
  const firstText = await layerRows.nth(0).textContent();
  expect(firstText).toContain("Layer 2");
});

// --- Recently deleted section -------------------------------------------------------

test("Recently deleted section hides when empty", async ({ page }) => {
  await openBuilder(page);
  // With no deleted items, the section should not exist.
  await expect(page.locator("text=Recently deleted")).toHaveCount(0);
});

test("Recently deleted section shows entries with time ago", async ({
  page,
}) => {
  await openBuilder(page);
  await addBuild(page);
  const menu = await openRowMenu(buildRow(page, "Build 2"));
  await confirmDangerAction(menu, "Delete");

  // Section should appear.
  const trash = recentlyDeletedHeader(page);
  await expect(trash).toBeVisible();

  // Expand and check it shows the build name in the trash section.
  await trash.click();
  await expect(
    page.locator(".nav-row").filter({ hasText: "Build 2" }),
  ).toBeVisible();
  await expect(page.locator("text=just now")).toBeVisible();
});

// --- Duplicate ----------------------------------------------------------------------

test("duplicating a build creates a copy and switches to it", async ({
  page,
}) => {
  await openBuilder(page);
  const menu = await openRowMenu(buildRow(page, "Build 1"));
  await menu.getByRole("button", { name: "Duplicate" }).click();

  const copy = buildRow(page, "Build 1 copy");
  await expect(copy).toBeVisible();
  await expect(copy).toHaveClass(/is-active/);
});

// --- Delete last build --------------------------------------------------------------

test("deleting the last build drops back to the landing screen", async ({
  page,
}) => {
  await openBuilder(page);

  // Delete the only build.
  const menu = await openRowMenu(buildRow(page, "Build 1"));
  await confirmDangerAction(menu, "Delete");

  // With nothing left to edit, the landing screen takes the builder's place -- and with it
  // the whole nav, so the trash has to be checked from the other side of the trip back.
  await expect(page.getByTestId("landing")).toBeVisible();

  await page.getByTestId("landing-new-build").click();
  const trash = recentlyDeletedHeader(page);
  await expect(trash).toBeVisible();
});

test("clicking outside an open menu closes it", async ({ page }) => {
  await openBuilder(page);
  const menu = await openRowMenu(buildRow(page, "Build 1"));
  await expect(menu).toBeVisible();

  // Click on the main editor area, outside the nav sidebar and the teleported menu.
  await page.getByTestId("builder-content").click({ position: { x: 2, y: 2 } });
  await expect(menu).toBeHidden();
});

test("clicking elsewhere in the sidebar closes an open menu", async ({
  page,
}) => {
  await openBuilder(page);
  await addBuild(page);
  const menu = await openRowMenu(buildRow(page, "Build 2"));
  await expect(menu).toBeVisible();

  // Click on another row's name -- still inside the sidebar, but outside the menu.
  await buildRow(page, "Build 1").locator(".nav-name").click();
  await expect(menu).toBeHidden();
});

test("clicking a different row's kebab switches the menu", async ({ page }) => {
  await openBuilder(page);
  await addLayer(page);

  // Open menu on Build 1.
  await openRowMenu(buildRow(page, "Build 1"));

  // Click Layer 1's kebab -- the menu should switch to show layer actions.
  // BasePopover teleports the menu to <body>, so there is a single .navmenu
  // element at any time; verify it shows layer items after the switch.
  await layerRow(page, "Layer 1").locator(".nav-kebab").click();
  const menu = page.locator(".navmenu");
  await expect(menu).toBeVisible();
  await expect(menu.getByRole("button", { name: "Duplicate" })).toBeVisible();
});

// --- Keyboard navigation --------------------------------------------------------------

test("ArrowDown/ArrowUp move the build selection", async ({ page }) => {
  await openBuilder(page);
  await addBuild(page);
  await expect(buildRow(page, "Build 2")).toHaveClass(/is-active/);

  await buildRow(page, "Build 1").locator(".nav-name").focus();
  await page.keyboard.press("ArrowDown");
  await expect(buildRow(page, "Build 2")).toHaveClass(/is-active/);
  await expect(buildRow(page, "Build 2").locator(".nav-name")).toBeFocused();

  await page.keyboard.press("ArrowUp");
  await expect(buildRow(page, "Build 1")).toHaveClass(/is-active/);
  await expect(buildRow(page, "Build 1").locator(".nav-name")).toBeFocused();
});

test("Ctrl+ArrowUp reorders the focused build like Move up", async ({
  page,
}) => {
  await openBuilder(page);
  await addBuild(page);
  await expect(buildRow(page, "Build 2")).toBeVisible();

  await buildRow(page, "Build 2").locator(".nav-name").focus();
  await page.keyboard.press("Control+ArrowUp");

  const buildRows = page.locator(".nav-row--build");
  await expect(buildRows.nth(0)).toContainText("Build 2");
  await expect(buildRows.nth(1)).toContainText("Build 1");
});

test("Ctrl+ArrowUp keeps focus on the moved row so it can be repeated", async ({
  page,
}) => {
  await openBuilder(page);
  await addBuild(page);
  await addBuild(page);
  await expect(buildRow(page, "Build 3")).toBeVisible();

  await buildRow(page, "Build 3").locator(".nav-name").focus();
  await page.keyboard.press("Control+ArrowUp");
  await expect(buildRow(page, "Build 3").locator(".nav-name")).toBeFocused();

  // Focus survived the first move, so a second Ctrl+ArrowUp keeps moving the same build.
  await page.keyboard.press("Control+ArrowUp");

  const buildRows = page.locator(".nav-row--build");
  await expect(buildRows.nth(0)).toContainText("Build 3");
  await expect(buildRows.nth(1)).toContainText("Build 1");
  await expect(buildRows.nth(2)).toContainText("Build 2");
});

test("F2 on a focused row starts rename", async ({ page }) => {
  await openBuilder(page);
  await buildRow(page, "Build 1").locator(".nav-name").focus();
  await page.keyboard.press("F2");

  const input = page.locator(".nav-rename");
  await expect(input).toBeFocused();
  await expect(input).toHaveValue("Build 1");
});

test("committing a rename with Enter returns focus to the row for continued keyboard nav", async ({
  page,
}) => {
  await openBuilder(page);
  await addBuild(page);
  await buildRow(page, "Build 1").locator(".nav-name").focus();
  await page.keyboard.press("F2");

  const input = page.locator(".nav-rename");
  await input.fill("Renamed");
  await input.press("Enter");

  const renamed = buildRow(page, "Renamed");
  await expect(renamed.locator(".nav-name")).toBeFocused();

  // Focus survived the rename, so arrow nav still works right after.
  await page.keyboard.press("ArrowDown");
  await expect(buildRow(page, "Build 2")).toHaveClass(/is-active/);
});

test("cancelling a rename with Escape returns focus to the row", async ({
  page,
}) => {
  await openBuilder(page);
  await buildRow(page, "Build 1").locator(".nav-name").focus();
  await page.keyboard.press("F2");
  await page.keyboard.press("Escape");

  await expect(buildRow(page, "Build 1").locator(".nav-name")).toBeFocused();
  await expect(buildRow(page, "Build 1")).toBeVisible();

  // Focus survived, so keyboard nav still works right after.
  await page.keyboard.press("F2");
  await expect(page.locator(".nav-rename")).toBeFocused();
});

test("Delete on a focused row arms a confirm notice, and fires on the second press", async ({
  page,
}) => {
  await openBuilder(page);
  await addBuild(page);
  await expect(buildRow(page, "Build 2")).toBeVisible();

  await buildRow(page, "Build 2").locator(".nav-name").focus();
  await page.keyboard.press("Delete");

  // First press only arms the confirm -- the row is still there.
  await expect(
    page.getByText('Press Delete again to delete "Build 2".'),
  ).toBeVisible();
  await expect(buildRow(page, "Build 2")).toBeVisible();

  await page.keyboard.press("Delete");

  // Second press actually deletes it.
  await expect(buildRow(page, "Build 2")).toHaveCount(0);
  const trash = recentlyDeletedHeader(page);
  await expect(trash).toBeVisible();
});

// --- Row alignment ------------------------------------------------------------------

/** How far a child's vertical centre sits from its row's, in px. */
async function centreOffset(row: Locator, childSelector: string) {
  const rowBox = await row.boundingBox();
  const childBox = await row.locator(childSelector).boundingBox();
  if (!rowBox || !childBox)
    throw new Error(`no layout box for ${childSelector}`);
  return Math.abs(
    rowBox.y + rowBox.height / 2 - (childBox.y + childBox.height / 2),
  );
}

test("kebab icons sit on their row's vertical centre", async ({ page }) => {
  await openBuilder(page);
  await addFolder(page);
  await addLayer(page);

  for (const row of [
    buildRow(page, "Build 1"),
    folderRow(page, "Folder 1"),
    layerRow(page, "Layer 1"),
  ]) {
    // Sub-pixel rather than exact: row heights land on half pixels at this font size.
    expect(await centreOffset(row, ".nav-kebab svg")).toBeLessThan(1);
  }
});

test("a top-level build name lines up with a folder name", async ({ page }) => {
  await openBuilder(page);
  await addFolder(page);

  const build = await buildRow(page, "Build 1")
    .locator(".nav-name")
    .boundingBox();
  const folder = await folderRow(page, "Folder 1")
    .locator(".nav-name")
    .boundingBox();
  expect(build!.x).toBeCloseTo(folder!.x, 0);
});
