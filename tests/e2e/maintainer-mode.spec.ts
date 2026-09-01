// The maintainer export tabs are opt-in for anyone running the shipped app, so a player never
// meets three tabs named after this repo's data files. A dev build defaults the other way --
// which is what these tests see, since Playwright drives the dev server. The shipped default
// is covered in tests/unit/stores/maintainer.spec.ts, the only place it can be observed.
import { test, expect, type Page } from "@playwright/test";
import { addLayer, layerRow } from "./support/nav";

/** Boots the app at `url` and steps past the landing screen. `openBuilder` starts with its own
 *  `goto("/")`, which would throw away the query string these tests arrive on. A fresh context
 *  has nothing stored, so the landing screen is always what loads first. */
async function bootAt(page: Page, url: string) {
  const newBuild = page.getByTestId("landing-new-build");
  await page.goto(url);
  await expect(newBuild).toBeVisible({ timeout: 15000 });
  await newBuild.click();
  await page.mouse.move(0, 0);
}

/** A later visit in the same context, which has builds stored by now and so lands in the
 *  builder rather than on the landing screen. */
async function revisit(page: Page, url: string) {
  await page.goto(url);
  await expect(page.getByTestId("app-header")).toBeVisible({ timeout: 15000 });
}

async function openLayer(page: Page) {
  await addLayer(page);
  await layerRow(page, "Layer 1").locator(".nav-name").click();
}

async function openExport(page: Page) {
  await page.getByTestId("layer-export-toggle").click();
  await expect(page.getByTestId("layer-export")).toBeVisible();
}

async function closeExport(page: Page) {
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("layer-export")).toHaveCount(0);
}

const maintainerTab = (page: Page) =>
  page
    .getByTestId("layer-export")
    .getByRole("button", { name: "db-items.json" });

const overlayTab = (page: Page) =>
  page.getByTestId("layer-export").getByRole("button", { name: "This layer" });

async function setMaintainer(page: Page, on: boolean) {
  await page.getByTestId("header-about").click();
  await page.getByTestId("about-maintainer").locator("input").setChecked(on);
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("about-dialog")).toHaveCount(0);
}

test("a dev build starts with the data-file tabs already available", async ({
  page,
}) => {
  await bootAt(page, "/");
  await openLayer(page);
  await openExport(page);

  await expect(maintainerTab(page)).toBeVisible();
});

test("the tab composes its file rather than only appearing", async ({
  page,
}) => {
  await bootAt(page, "/");
  await openLayer(page);
  await openExport(page);

  // The module behind the tab is fetched on demand, so a build that dropped that chunk would
  // still render the tab itself.
  await maintainerTab(page).click();
  await expect(page.getByTestId("layer-export")).toContainText(
    "Download db-items.json",
  );
});

test("?maintainer=0 puts the data-file tabs away and leaves the URL", async ({
  page,
}) => {
  await bootAt(page, "/?maintainer=0");

  expect(new URL(page.url()).searchParams.has("maintainer")).toBe(false);

  await openLayer(page);
  await openExport(page);

  await expect(overlayTab(page)).toBeVisible();
  await expect(maintainerTab(page)).toHaveCount(0);
});

test("?maintainer=1 turns them back on and leaves the URL", async ({
  page,
}) => {
  await bootAt(page, "/?maintainer=0");
  await revisit(page, "/?maintainer=1");

  expect(new URL(page.url()).searchParams.has("maintainer")).toBe(false);

  await openLayer(page);
  await openExport(page);

  await expect(maintainerTab(page)).toBeVisible();
});

test("the About toggle puts the tabs away and brings them back", async ({
  page,
}) => {
  await bootAt(page, "/");
  await openLayer(page);

  await setMaintainer(page, false);
  await openExport(page);
  await expect(maintainerTab(page)).toHaveCount(0);
  await closeExport(page);

  await setMaintainer(page, true);
  await openExport(page);
  await expect(maintainerTab(page)).toBeVisible();
});
