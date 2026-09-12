// Sidebar rows carry one focus outline on the row itself (`focus-within`), so a click, a Tab
// and the focus hand-back after a rename all light the same box around name, kebab and
// padding. The inner controls suppress their own outlines so nothing doubles up.
import { test, expect, type Locator } from "@playwright/test";
import { openBuilder } from "./support/app";
import {
  buildRow,
  folderRow,
  layerRow,
  addFolder,
  addLayer,
} from "./support/nav";

async function expectRowOutline(row: Locator) {
  await expect(row).toHaveCSS("outline-style", "solid");
  await expect(row).toHaveCSS("outline-width", "2px");
  // Fully inside the box: the nav column clips anything drawn past the row edge.
  await expect(row).toHaveCSS("outline-offset", "-2px");
}

async function expectNoOutline(el: Locator) {
  await expect(el).toHaveCSS("outline-style", "none");
}

test.describe("clicking a row lights the row outline, not the inner button", () => {
  test("build row", async ({ page }) => {
    await openBuilder(page);
    const row = buildRow(page, "Build 1");
    await expectNoOutline(row);

    await row.locator(".nav-name").click();
    await expect(row.locator(".nav-name")).toBeFocused();
    await expectRowOutline(row);
    await expectNoOutline(row.locator(".nav-name"));
  });

  test("folder row", async ({ page }) => {
    await openBuilder(page);
    await addFolder(page);
    const row = folderRow(page, "Folder 1");

    await row.locator(".nav-name").click();
    await expect(row.locator(".nav-name")).toBeFocused();
    await expectRowOutline(row);
    await expectNoOutline(row.locator(".nav-name"));
  });

  test("layer row", async ({ page }) => {
    await openBuilder(page);
    await addLayer(page);
    const row = layerRow(page, "Layer 1");

    await row.locator(".nav-name").click();
    await expect(row.locator(".nav-name")).toBeFocused();
    await expectRowOutline(row);
    await expectNoOutline(row.locator(".nav-name"));
  });
});

test("focusing the kebab lights the same row outline", async ({ page }) => {
  await openBuilder(page);
  const row = buildRow(page, "Build 1");

  await row.locator(".nav-kebab").focus();
  await expect(row.locator(".nav-kebab")).toBeFocused();
  await expectRowOutline(row);
  await expectNoOutline(row.locator(".nav-kebab"));
});

test("tabbing into a row lights the row outline", async ({ page }) => {
  await openBuilder(page);
  const row = buildRow(page, "Build 1");

  // The Builds filter sits right before the first row in the tab order.
  await page.getByTestId("nav-builds-filter").focus();
  await expectNoOutline(row);
  await page.keyboard.press("Tab");

  await expect(row.locator(".nav-name")).toBeFocused();
  await expectRowOutline(row);
});

test("the rename input keeps the outline on the row, before and after commit", async ({
  page,
}) => {
  await openBuilder(page);
  const row = buildRow(page, "Build 1");

  await row.locator(".nav-name").dblclick();
  const input = page.locator(".nav-rename");
  await expect(input).toBeFocused();
  // The row locator stops matching by text once the name lives in the input's value, so the
  // row is reached from the input instead.
  const renamingRow = input.locator(
    "xpath=ancestor::*[contains(@class, 'nav-row--build')]",
  );
  await expectRowOutline(renamingRow);
  await expectNoOutline(input);

  await input.fill("Renamed");
  await input.press("Enter");

  const renamed = buildRow(page, "Renamed");
  await expect(renamed.locator(".nav-name")).toBeFocused();
  await expectRowOutline(renamed);
  await expectNoOutline(renamed.locator(".nav-name"));
});
