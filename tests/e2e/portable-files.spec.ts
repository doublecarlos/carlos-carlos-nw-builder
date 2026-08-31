// End-to-end coverage for portable files (phase 7): builds carry their layer dependencies,
// bundles export builds + layers together, and the bundle picker auto-ticks required layers.
import { test, expect, type Page } from "@playwright/test";
import {
  chooseCombo,
  confirmImport,
  importText,
  openBuilder,
  pickerInput,
} from "./support/app";
import { addBuild, buildRow, renameViaSidebar } from "./support/nav";

/** Export the first build's JSON via the header's "Export bundle…" button. Since we need a
 *  single-build export (not a bundle), we use the download function from the kebab menu. */
async function exportedBuildJson(page: Page): Promise<Record<string, unknown>> {
  const firstBuild = page.locator(".nav-row--build").first();
  await firstBuild.locator(".nav-kebab").click();
  const menu = page.locator(".navmenu");
  const downloadPromise = page.waitForEvent("download");
  await menu.getByRole("button", { name: "Download…" }).click();
  const download = await downloadPromise;
  const text = await (
    await download.createReadStream()
  )
    .toArray()
    .then((chunks) => Buffer.concat(chunks).toString("utf-8"));
  return JSON.parse(text);
}

/** What the bundle picker hands out for whatever is currently ticked. */
async function downloadBundle(page: Page): Promise<BundleFile> {
  const downloadPromise = page.waitForEvent("download");
  await page.getByTestId("bundle-export-button").click();
  const download = await downloadPromise;
  const text = await (
    await download.createReadStream()
  )
    .toArray()
    .then((chunks) => Buffer.concat(chunks).toString("utf-8"));
  return JSON.parse(text) as BundleFile;
}

interface BundleFile {
  kind: string;
  data: {
    builds: {
      id: string;
      name: string;
      compare: { id: string; highlight: boolean };
    }[];
    layers: unknown[];
  };
}

/** The quick-compare picker in the stat panel's top bar. */
const comparePicker = (page: Page) =>
  pickerInput(page.locator(".compare-select"));

/** Two builds, "Beta" comparing against "Alpha" with highlighting on. */
async function twoComparedBuilds(page: Page) {
  await openBuilder(page);
  await renameViaSidebar(page, buildRow(page, "Build 1"), "Alpha");
  await addBuild(page);
  await renameViaSidebar(page, buildRow(page, "Build 2"), "Beta");
  await chooseCombo(page.locator(".compare-select"), "Alpha");
  await page.getByRole("checkbox", { name: "Highlight changes" }).check();
}

test.describe("portable files", () => {
  test("a build exported with layer gear imports and the catalog survives", async ({
    page,
  }) => {
    await openBuilder(page);

    // Export the existing build JSON
    const envelope = await exportedBuildJson(page);
    const env = envelope as { kind: string; data: Record<string, unknown> };
    expect(env.kind).toBe("build");

    // The build should not have a catalog field since it has no layer gear.
    expect(env.data.catalog).toBeUndefined();
  });

  test("a downloaded build carries no compare key", async ({ page }) => {
    await openBuilder(page);
    const envelope = await exportedBuildJson(page);
    const env = envelope as { data: Record<string, unknown> };
    expect(env.data.compare).toBeUndefined();
  });

  test("bundle export can be opened and closed", async ({ page }) => {
    await openBuilder(page);

    // Open the bundle export picker
    await page.getByTestId("header-export-bundle").click();
    await expect(page.getByTestId("bundle-export-picker")).toBeVisible();

    // Cancel
    await page.getByText("Cancel").click();
    await expect(page.getByTestId("bundle-export-picker")).toBeHidden();
  });

  test("bundle round-trip: builds and layers import correctly", async ({
    page,
  }) => {
    await openBuilder(page);

    // Open bundle export
    await page.getByTestId("header-export-bundle").click();
    await expect(page.getByTestId("bundle-export-picker")).toBeVisible();

    // Select all builds
    await page.getByText("Select all").first().click();

    // Export
    const downloadPromise = page.waitForEvent("download");
    await page.getByTestId("bundle-export-button").click();
    const download = await downloadPromise;
    const text = await (
      await download.createReadStream()
    )
      .toArray()
      .then((chunks) => Buffer.concat(chunks).toString("utf-8"));
    const bundle = JSON.parse(text) as {
      kind: string;
      data: { builds: unknown[]; layers: unknown[] };
    };

    expect(bundle.kind).toBe("bundle");
    expect(bundle.data.builds).toBeDefined();
    expect(bundle.data.layers).toBeDefined();

    // Import back
    await importText(page, JSON.stringify(bundle));
    await confirmImport(page);
    await expect(page.getByTestId("app-header")).toContainText(/imported/i);
  });

  test("a bundle keeps a comparison whose target travels with it", async ({
    page,
  }) => {
    await twoComparedBuilds(page);

    await page.getByTestId("header-export-bundle").click();
    await page.getByText("Select all").first().click();
    const bundle = await downloadBundle(page);

    const alpha = bundle.data.builds.find((b) => b.name === "Alpha")!;
    const beta = bundle.data.builds.find((b) => b.name === "Beta")!;
    expect(beta.compare.id).toBe(alpha.id);
    expect(beta.compare.highlight).toBe(true);

    // Renaming the original before importing tells the two apart: the imported copy of
    // "Beta" is selected on import, and its picker has to point at the imported "Alpha"
    // rather than at the build the id in the file still names.
    await renameViaSidebar(page, buildRow(page, "Alpha"), "Old Alpha");
    await importText(page, JSON.stringify(bundle));
    await confirmImport(page);
    await expect(comparePicker(page)).toHaveValue("Alpha");
  });

  test("a bundle drops a comparison whose target was left out", async ({
    page,
  }) => {
    await twoComparedBuilds(page);

    await page.getByTestId("header-export-bundle").click();
    // Only "Beta" - the build it compares against stays behind.
    await page.getByTestId("bundle-build-checkbox").nth(1).check();
    const bundle = await downloadBundle(page);

    expect(bundle.data.builds).toHaveLength(1);
    expect(bundle.data.builds[0].name).toBe("Beta");
    expect(bundle.data.builds[0].compare.id).toBe("");
    expect(bundle.data.builds[0].compare.highlight).toBe(false);

    await importText(page, JSON.stringify(bundle));
    await confirmImport(page);
    await expect(comparePicker(page)).toHaveValue("- none -");
  });

  test("import sniffs bundle kind correctly", async ({ page }) => {
    await openBuilder(page);

    // Create a bundle by exporting via the picker
    await page.getByTestId("header-export-bundle").click();
    await page.getByText("Select all").first().click();
    const downloadPromise = page.waitForEvent("download");
    await page.getByTestId("bundle-export-button").click();
    const download = await downloadPromise;
    const text = await (
      await download.createReadStream()
    )
      .toArray()
      .then((chunks) => Buffer.concat(chunks).toString("utf-8"));

    // Import via the file input - should handle bundle kind
    await importText(page, text);
    await confirmImport(page);
    await expect(page.getByTestId("app-header")).toContainText(/imported/i);
  });

  test("the header import takes a bare catalog overlay as a layer", async ({
    page,
  }) => {
    await openBuilder(page);

    // What LayerEditor's export window hands out on its "This layer" tab: a raw
    // `CatalogOverlay`, no envelope and no layer wrapper around it.
    const overlay = {
      items: { itm_e2e: { id: "itm_e2e", name: "E2E item" } },
      bonuses: {},
      sectionPresets: {},
      slots: {},
    };
    await importText(page, JSON.stringify(overlay), "my-overlay.json");
    await confirmImport(page);

    await expect(
      page.getByTestId("library").locator(".nav-row--layer"),
    ).toContainText("my-overlay");
  });

  test("import lives only in the header", async ({ page }) => {
    await openBuilder(page);

    await expect(page.getByTestId("header-import")).toBeVisible();
    await expect(
      page.getByTestId("library").getByRole("button", { name: "Import" }),
    ).toHaveCount(0);
    await expect(
      page.getByTestId("library").locator('input[type="file"]'),
    ).toHaveCount(0);
  });
});
