// End-to-end coverage for the import picker: what a file offers, what of it the user takes,
// and what happens to something already here under the same id.
import { test, expect, type Page } from "@playwright/test";
import { confirmImport, importText, openBuilder } from "./support/app";
import {
  buildRow,
  layerRow,
  recentlyDeletedHeader,
  renameViaSidebar,
} from "./support/nav";

/** An un-enveloped bundle: two builds and a layer, none of them known to the workspace. Ids
 *  are spelled out, as a real export's are - they are what a second import recognises. */
const bundle = JSON.stringify({
  builds: [
    { id: "b_bundle_a", name: "Bundle A" },
    { id: "b_bundle_b", name: "Bundle B" },
  ],
  layers: [
    {
      id: "l_bundle",
      name: "Bundle layer",
      enabled: true,
      overlay: { items: {}, bonuses: {}, sectionPresets: {}, slots: {} },
    },
  ],
});

const picker = (page: Page) => page.getByTestId("import-picker");

/** The open build, exported through the sidebar's own Download - so the file carries the id
 *  it still has here, which is what makes importing it back a conflict. */
async function exportedBuild(page: Page): Promise<string> {
  await page.locator(".nav-row--build").first().locator(".nav-kebab").click();
  const downloadPromise = page.waitForEvent("download");
  await page
    .locator(".navmenu")
    .getByRole("button", { name: "Download…" })
    .click();
  const download = await downloadPromise;
  const chunks = await (await download.createReadStream()).toArray();
  return Buffer.concat(chunks).toString("utf-8");
}

test("importing from the landing screen leaves no placeholder build behind", async ({
  page,
}) => {
  // Not `openBuilder`: its "New build" click is what commits the placeholder, and the point
  // here is the visitor who imports instead of starting one.
  await page.goto("/");
  await expect(page.getByTestId("landing-new-build")).toBeVisible({
    timeout: 15000,
  });

  await page
    .getByTestId("landing")
    .locator('input[type="file"]')
    .setInputFiles({
      name: "import.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify({ name: "Only build" }), "utf-8"),
    });
  await confirmImport(page);

  await expect(page.locator(".nav-row--build")).toHaveCount(1);
  await expect(buildRow(page, "Only build")).toBeVisible();
});

test("a single build goes through the picker too", async ({ page }) => {
  await openBuilder(page);

  await importText(page, JSON.stringify({ name: "Solo import" }));

  await expect(picker(page)).toBeVisible();
  await expect(page.getByTestId("import-summary")).toContainText("1 build");
  await confirmImport(page);

  await expect(buildRow(page, "Solo import")).toBeVisible();
});

test("Enter takes the whole file, without touching the mouse", async ({
  page,
}) => {
  await openBuilder(page);
  await importText(page, bundle);

  await page.keyboard.press("Enter");

  await expect(picker(page)).toBeHidden();
  await expect(buildRow(page, "Bundle A")).toBeVisible();
  await expect(layerRow(page, "Bundle layer")).toBeVisible();
});

test("the same file imported twice is offered as a replacement the second time", async ({
  page,
}) => {
  await openBuilder(page);
  await importText(page, bundle);
  await confirmImport(page);

  await importText(page, bundle);

  // The ids the file carries survived the first import, so the second recognises them.
  await expect(page.getByTestId("import-conflict")).toHaveCount(3);
  await page.getByTestId("import-all-replace").click();
  await confirmImport(page);

  await expect(buildRow(page, "Bundle A")).toHaveCount(1);
  await expect(layerRow(page, "Bundle layer")).toHaveCount(1);
});

test("a bundle raises the picker and imports all of it on Import", async ({
  page,
}) => {
  await openBuilder(page);

  await importText(page, bundle, "nw-bundle.json");

  await expect(page.getByTestId("import-summary")).toContainText(
    "2 builds and 1 layer",
  );
  await expect(page.getByTestId("import-summary")).toContainText(
    "nw-bundle.json",
  );
  await expect(page.getByTestId("import-confirm")).toContainText("Import 3");

  await confirmImport(page);

  await expect(buildRow(page, "Bundle A")).toBeVisible();
  await expect(buildRow(page, "Bundle B")).toBeVisible();
  await expect(layerRow(page, "Bundle layer")).toBeVisible();
});

test("an unticked row is left behind", async ({ page }) => {
  await openBuilder(page);
  await importText(page, bundle);

  await page.getByTestId("import-build-checkbox").nth(1).uncheck();
  await page.getByTestId("import-layer-checkbox").uncheck();
  await expect(page.getByTestId("import-confirm")).toContainText("Import 1");
  await confirmImport(page);

  await expect(buildRow(page, "Bundle A")).toBeVisible();
  await expect(buildRow(page, "Bundle B")).toHaveCount(0);
  await expect(layerRow(page, "Bundle layer")).toHaveCount(0);
});

test("cancelling imports nothing", async ({ page }) => {
  await openBuilder(page);
  await importText(page, bundle);

  await page.getByTestId("import-cancel").click();

  await expect(picker(page)).toBeHidden();
  await expect(buildRow(page, "Bundle A")).toHaveCount(0);
});

test("nothing ticked is nothing to import", async ({ page }) => {
  await openBuilder(page);
  await importText(page, bundle);

  await page.getByTestId("import-select-none").click();

  await expect(page.getByTestId("import-confirm")).toBeDisabled();
});

test.describe("a build already here under the same id", () => {
  test("keeps both by default", async ({ page }) => {
    await openBuilder(page);
    await renameViaSidebar(
      page,
      page.locator(".nav-row--build").first(),
      "Alpha",
    );
    const exported = await exportedBuild(page);

    await importText(page, exported);
    await expect(page.getByTestId("import-conflict")).toBeVisible();
    await confirmImport(page);

    await expect(page.locator(".nav-row--build")).toHaveCount(2);
  });

  test("replaces it when asked, and the old copy is recoverable", async ({
    page,
  }) => {
    await openBuilder(page);
    await renameViaSidebar(
      page,
      page.locator(".nav-row--build").first(),
      "Alpha",
    );
    const exported = await exportedBuild(page);
    // Renaming after the export tells the two apart: the file still carries "Alpha".
    await renameViaSidebar(page, buildRow(page, "Alpha"), "Stale name");

    await importText(page, exported);
    await page.getByTestId("import-build-replace").click();
    await expect(page.getByTestId("import-replace-warning")).toBeVisible();
    await confirmImport(page);

    await expect(page.locator(".nav-row--build")).toHaveCount(1);
    await expect(buildRow(page, "Alpha")).toBeVisible();
    await expect(recentlyDeletedHeader(page)).toBeVisible();
  });
});
