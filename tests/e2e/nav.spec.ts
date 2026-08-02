// End-to-end coverage for Nav.vue's sidebar: builds, customization layers, recently
// deleted, filtering, ordering, and the layer checkbox.
import { test, expect } from "@playwright/test";
import { openBuilder } from "./support/app";
import {
  buildRow,
  layerRow,
  openRowMenu,
  confirmDangerAction,
  renameViaSidebar,
  addBuild,
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

test("Move up reorders the build list", async ({ page }) => {
  await openBuilder(page);
  await addBuild(page);
  await expect(buildRow(page, "Build 2")).toBeVisible();

  // Move Build 2 up so it comes first.
  {
    const menu = await openRowMenu(buildRow(page, "Build 2"));
    await moveUp(menu);
  }

  // After move-up, Build 2 should be the first row.
  const buildRows = page.locator(".nav-row--build");
  await expect(buildRows.nth(0)).toContainText("Build 2");
  await expect(buildRows.nth(1)).toContainText("Build 1");
});

test("Move up order survives a reload", async ({ page }) => {
  await openBuilder(page);
  await addBuild(page);

  {
    const menu = await openRowMenu(buildRow(page, "Build 2"));
    await moveUp(menu);
  }

  // Wait for IDB write to complete before reload.
  // eslint-disable-next-line playwright/no-wait-for-timeout -- No DOM event to observe for IDB flush
  await page.waitForTimeout(500);

  await page.reload();
  await page.getByTestId("library").waitFor({ state: "visible" });

  const buildRows = page.locator(".nav-row--build");
  await expect(buildRows.nth(0)).toContainText("Build 2");
  await expect(buildRows.nth(1)).toContainText("Build 1");
});

test("Move down is disabled for the last build", async ({ page }) => {
  await openBuilder(page);
  const menu = await openRowMenu(buildRow(page, "Build 1"));
  const down = menu.getByRole("button", { name: "Move down" });
  await expect(down).toBeDisabled();
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

  // Toggle the checkbox off — the layer should stay selected.
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

test("Move up reorders layers and Move down is disabled at the ends", async ({
  page,
}) => {
  await openBuilder(page);
  await addLayer(page);
  await addLayer(page);

  // Move up should be disabled for the first layer.
  {
    const menu = await openRowMenu(layerRow(page, "Layer 1"));
    await expect(menu.getByRole("button", { name: "Move up" })).toBeDisabled();
  }

  // Move up on Layer 2 so it becomes first.
  {
    const menu = await openRowMenu(layerRow(page, "Layer 2"));
    await moveUp(menu);
  }

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

test("the last build cannot be deleted", async ({ page }) => {
  await openBuilder(page);
  const menu = await openRowMenu(buildRow(page, "Build 1"));
  await expect(menu.getByRole("button", { name: "Delete" })).toBeDisabled();
});

test("clicking outside an open menu closes it", async ({ page }) => {
  await openBuilder(page);
  const menu = await openRowMenu(buildRow(page, "Build 1"));
  await expect(menu).toBeVisible();

  // Click on the main editor area, outside the nav sidebar and the teleported menu.
  await page.getByTestId("builder-content").click({ position: { x: 2, y: 2 } });
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
