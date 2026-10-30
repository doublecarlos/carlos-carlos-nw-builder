// A row's menu in the phone nav drawer: the row is tall enough for its tap-sized buttons, so
// opening the menu does not scroll the list, which would close the menu again.
import { test, expect, type Page } from "@playwright/test";
import { openBuilder } from "../support/app";
import {
  addBuild,
  buildRow,
  confirmDangerAction,
  openRowMenu,
} from "../support/nav";

async function openDrawer(page: Page) {
  const drawer = page.getByTestId("nav-drawer");
  if (!(await drawer.isVisible()))
    await page.getByTestId("header-nav-toggle").click();
  await expect(drawer).toBeVisible();
}

test("deletes the selected build from the drawer", async ({ page }) => {
  await openBuilder(page);
  await openDrawer(page);
  await addBuild(page);
  await openDrawer(page);

  const selected = page.locator(".nav-row--build.is-active");
  await expect(selected).toContainText("Build 2");
  const menu = await openRowMenu(selected);
  await confirmDangerAction(menu, "Delete…");

  await expect(page.getByTestId("confirm-dialog")).toHaveCount(0);
  await openDrawer(page);
  await expect(buildRow(page, "Build 2")).toHaveCount(0);
  await expect(buildRow(page, "Build 1")).toBeVisible();
});

test("a row holds its tap-sized buttons without the list scrolling", async ({
  page,
}) => {
  await openBuilder(page);
  await openDrawer(page);
  const row = page.locator(".nav-row--build").first();
  const rowBox = (await row.boundingBox())!;
  for (const control of await row.locator("button").all()) {
    const box = (await control.boundingBox())!;
    expect(box.y).toBeGreaterThanOrEqual(rowBox.y - 0.5);
    expect(box.y + box.height).toBeLessThanOrEqual(
      rowBox.y + rowBox.height + 0.5,
    );
  }
  const list = page.getByTestId("nav-builds-list");
  const overflow = await list.evaluate(
    (el) => el.scrollHeight - el.clientHeight,
  );
  expect(overflow).toBeLessThanOrEqual(0);
});
