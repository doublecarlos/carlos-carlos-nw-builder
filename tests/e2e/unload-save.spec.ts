// Edits still waiting on the save debounce are written out when the page goes away.
import { test, expect } from "@playwright/test";
import { openBuilder } from "./support/app";
import { buildRow, layerRow, renameViaSidebar } from "./support/nav";
import { TEST_HEAD, importTestHead } from "./support/testHead";

test("a rename right before reload survives it", async ({ page }) => {
  await openBuilder(page);
  await renameViaSidebar(page, buildRow(page, "Build 1"), "Renamed Build");
  await expect(buildRow(page, "Renamed Build")).toBeVisible();

  // No wait for the debounce: the reload itself has to flush the save.
  await page.reload();
  await expect(buildRow(page, "Renamed Build")).toBeVisible();
});

test("an item edit right before reload survives it", async ({ page }) => {
  const item = TEST_HEAD.name;
  const renamed = `${item} (renamed)`;
  await openBuilder(page);
  await importTestHead(page);
  await layerRow(page, "Test head (imported)").locator(".nav-name").click();
  await page.locator(".editor-search").fill(item);
  await page.locator(".editor-row").filter({ hasText: item }).first().click();
  const nameInput = page.getByTestId("item-name-input");
  await expect(nameInput).toHaveValue(item);
  await nameInput.fill(renamed);

  // No wait for the form's debounce: the reload itself has to flush the edit.
  await page.reload();
  await page.locator(".editor-search").fill(renamed);
  await expect(
    page.locator(".editor-row").filter({ hasText: renamed }),
  ).toBeVisible();
});
