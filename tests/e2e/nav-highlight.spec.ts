// Whatever the editor shows, the nav highlights: a selection left naming a build or layer that is
// gone moves to the build the editor fell back to.
import { test, expect, type Page } from "@playwright/test";
import { headerRow, openBuilder } from "./support/app";
import {
  addBuild,
  addLayer,
  buildRow,
  confirmDangerAction,
  layerRow,
  openRowMenu,
} from "./support/nav";

const currentBuild = (page: Page) =>
  page.locator('.nav-row--build .nav-name[aria-current="true"]');

test("deleting the open layer, the last one, highlights the build that shows", async ({
  page,
}) => {
  await openBuilder(page);
  await addLayer(page);
  await layerRow(page, "Layer 1").locator(".nav-name").click();
  await expect(page.getByTestId("layer-entries-column")).toBeVisible();

  const menu = await openRowMenu(layerRow(page, "Layer 1"));
  await confirmDangerAction(menu, "Delete…");

  await expect(headerRow(page, "gear")).toBeVisible();
  await expect(currentBuild(page)).toHaveCount(1);
});

test("Back to a deleted build highlights the build that shows", async ({
  page,
}) => {
  await openBuilder(page);
  await addBuild(page);
  await expect(buildRow(page, "Build 2")).toBeVisible();
  await buildRow(page, "Build 1").locator(".nav-name").click();
  await expect(currentBuild(page)).toHaveText("Build 1");

  const menu = await openRowMenu(buildRow(page, "Build 2"));
  await confirmDangerAction(menu, "Delete…");
  await expect(buildRow(page, "Build 2")).toHaveCount(0);

  // The entry before is Build 2's, which is gone now.
  await page.goBack();
  await expect(headerRow(page, "gear")).toBeVisible();
  await expect(currentBuild(page)).toHaveCount(1);
});
