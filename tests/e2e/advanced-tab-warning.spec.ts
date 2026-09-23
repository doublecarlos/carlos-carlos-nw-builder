// The layer editor warns on the tabs that author data whose shape may still change.
import { test, expect } from "@playwright/test";
import { openBuilder } from "./support/app";
import { addLayer, layerRow } from "./support/nav";

test("the Filters and Slots tabs warn that editing them is advanced", async ({
  page,
}) => {
  await openBuilder(page);
  await addLayer(page);
  await layerRow(page, "Layer 1").locator(".nav-name").click();

  const warning = page.getByTestId("advanced-tab-warning");
  await expect(page.getByTestId("tab-items")).toBeVisible();
  await expect(warning).toHaveCount(0);

  await page.getByTestId("tab-bonuses").click();
  await expect(warning).toHaveCount(0);

  await page.getByTestId("tab-filters").click();
  await expect(warning).toContainText("advanced feature");

  await page.getByTestId("tab-slots").click();
  await expect(warning).toContainText("advanced feature");
});
