// Edits still waiting on the save debounce are written out when the page goes away.
import { test, expect } from "@playwright/test";
import { openBuilder } from "./support/app";
import { buildRow, renameViaSidebar } from "./support/nav";

test("a rename right before reload survives it", async ({ page }) => {
  await openBuilder(page);
  await renameViaSidebar(page, buildRow(page, "Build 1"), "Renamed Build");
  await expect(buildRow(page, "Renamed Build")).toBeVisible();

  // No wait for the debounce: the reload itself has to flush the save.
  await page.reload();
  await expect(buildRow(page, "Renamed Build")).toBeVisible();
});
