// Landing screen: what a first visit (nothing stored at all) shows, the way out of it, and
// the deletions that must not bring it back while the nav still has something to show.
import { test, expect } from "@playwright/test";
import { openBuilder } from "./support/app";
import {
  buildRow,
  layerRow,
  openRowMenu,
  confirmDangerAction,
  addBuild,
  addLayer,
  purgeFirstTrashEntry,
} from "./support/nav";

test("a fresh visit lands on the intro with a New build button", async ({
  page,
}) => {
  await page.goto("/");

  const landing = page.getByTestId("landing");
  await expect(landing).toBeVisible({ timeout: 10000 });
  await expect(
    landing.getByRole("heading", { name: "Carlos Carlos' NW Builder" }),
  ).toBeVisible();
  await expect(
    landing.getByText("Create and compare Neverwinter builds."),
  ).toBeVisible();

  // The watermark is decoration: present, faint, and invisible to the a11y tree.
  const watermark = page.getByTestId("landing-watermark");
  await expect(watermark).toHaveAttribute("aria-hidden", "true");
  const opacity = await watermark.evaluate((el) =>
    Number(getComputedStyle(el).opacity),
  );
  expect(opacity).toBeGreaterThan(0);
  expect(opacity).toBeLessThan(0.2);
});

test("New build leaves the landing screen for the builder", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByTestId("landing-new-build").click();

  await expect(page.getByTestId("landing")).toBeHidden();
  await expect(page.getByTestId("nav-column")).toBeVisible();
});

test("entering the builder lands on the one build the store already keeps", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByTestId("landing-new-build").click();

  const nav = page.getByTestId("nav-column");
  await expect(nav.getByRole("button", { name: "Build 1" })).toBeVisible();
  await expect(nav.getByRole("button", { name: /^Build \d+$/ })).toHaveCount(1);
});

test("a visit with stored builds skips the landing", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("landing-new-build").click();
  await expect(page.getByTestId("editor-column")).toBeVisible();

  await page.reload();
  await expect(page.getByTestId("editor-column")).toBeVisible({
    timeout: 10000,
  });
  await expect(page.getByTestId("landing")).toBeHidden();
});

test("deleting the last build keeps the builder up for the trash", async ({
  page,
}) => {
  await openBuilder(page);

  const menu = await openRowMenu(buildRow(page, "Build 1"));
  await confirmDangerAction(menu, "Delete");

  // The build just deleted is in the trash, and the landing screen would hide the nav that
  // is the only way to restore it.
  await expect(page.getByTestId("landing")).toBeHidden();
  await expect(page.getByTestId("editor-column")).toBeVisible();
  await expect(page.getByTestId("nav-trash")).toContainText(
    "Recently deleted (1)",
  );
});

test("deleting the last build keeps the builder up for existing layers", async ({
  page,
}) => {
  await openBuilder(page);
  await addLayer(page);
  await expect(layerRow(page, "Layer 1")).toBeVisible();

  const menu = await openRowMenu(buildRow(page, "Build 1"));
  await confirmDangerAction(menu, "Delete");

  await expect(page.getByTestId("landing")).toBeHidden();
  await expect(layerRow(page, "Layer 1")).toBeVisible();
});

test("deleting all but one build keeps the builder up", async ({ page }) => {
  await openBuilder(page);
  await addBuild(page);

  const menu = await openRowMenu(buildRow(page, "Build 2"));
  await confirmDangerAction(menu, "Delete");

  await expect(page.getByTestId("editor-column")).toBeVisible();
  await expect(page.getByTestId("landing")).toBeHidden();
});

test("a reload after the last build is deleted opens the builder, not the landing", async ({
  page,
}) => {
  await openBuilder(page);
  const menu = await openRowMenu(buildRow(page, "Build 1"));
  await confirmDangerAction(menu, "Delete");
  await expect(page.getByTestId("nav-trash")).toContainText(
    "Recently deleted (1)",
  );

  // The deletion is stored, so the next visit is not a browser with nothing on it.
  await page.reload();
  await expect(page.getByTestId("editor-column")).toBeVisible({
    timeout: 10000,
  });
  await expect(page.getByTestId("landing")).toBeHidden();
  await expect(page.getByTestId("nav-trash")).toContainText(
    "Recently deleted (1)",
  );
});

test("purging the last deleted build brings the landing back", async ({
  page,
}) => {
  await openBuilder(page);
  const menu = await openRowMenu(buildRow(page, "Build 1"));
  await confirmDangerAction(menu, "Delete");
  await expect(page.getByTestId("nav-trash")).toBeVisible();

  await purgeFirstTrashEntry(page);

  await expect(page.getByTestId("landing")).toBeVisible();

  // Nothing was written on the way through: the build left standing behind the landing is
  // the placeholder, so the next visit starts here too.
  await page.reload();
  await expect(page.getByTestId("landing")).toBeVisible({ timeout: 10000 });
});

test("purging the last deleted build leaves the builder up for a layer", async ({
  page,
}) => {
  await openBuilder(page);
  await addLayer(page);
  const menu = await openRowMenu(buildRow(page, "Build 1"));
  await confirmDangerAction(menu, "Delete");

  await purgeFirstTrashEntry(page);

  await expect(page.getByTestId("landing")).toBeHidden();
  await expect(layerRow(page, "Layer 1")).toBeVisible();
});

test("deleting the last build leaves one fresh build behind", async ({
  page,
}) => {
  await openBuilder(page);
  const menu = await openRowMenu(buildRow(page, "Build 1"));
  await confirmDangerAction(menu, "Delete");

  await expect(page.getByTestId("editor-column")).toBeVisible();
  await expect(
    page.getByTestId("nav-column").getByRole("button", { name: /^Build \d+$/ }),
  ).toHaveCount(1);
});
