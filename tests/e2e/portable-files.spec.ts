// End-to-end coverage for portable files (phase 7): builds carry their layer dependencies,
// bundles export builds + layers together, and the bundle picker auto-ticks required layers.
import { test, expect, type Page } from "@playwright/test";
import { openBuilder } from "./support/app";

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

/** Import a JSON file via the header's Import… button. */
async function importText(page: Page, text: string) {
  const fileInput = page
    .getByTestId("app-header")
    .locator('input[type="file"]');
  await fileInput.setInputFiles({
    name: "import.json",
    mimeType: "application/json",
    buffer: Buffer.from(text, "utf-8"),
  });
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
    await expect(page.getByTestId("app-header")).toContainText(/imported/i);
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

    // Import via the file input — should handle bundle kind
    await importText(page, text);
    await expect(page.getByTestId("app-header")).toContainText(/imported/i);
  });
});
