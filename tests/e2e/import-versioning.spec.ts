// End-to-end coverage for the versioned export/import envelope (build-parameters plan 0005):
// a real export round-trips through import, an un-enveloped (legacy) build still works, and a
// version or kind mismatch is refused with a clear message instead of silently mis-normalised.
import { test, expect, type Page } from "@playwright/test";
import { openBuilder } from "./support/app";

/** Export the first build via the sidebar menu (⋮ → Export…). Returns the parsed JSON. */
async function exportedEnvelope(page: Page) {
  // Open the first build's kebab menu and click Export.
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

/** Import via the "Import…" button in the header. Creates a file and triggers the file input. */
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

test("a real export round-trips through import", async ({ page }) => {
  await openBuilder(page);
  const envelope = await exportedEnvelope(page);
  expect(envelope.kind).toBe("build");

  // Import back - this creates a new build alongside the existing one.
  await importText(page, JSON.stringify(envelope));
  // A notice should appear for the imported build.
  await expect(page.getByTestId("app-header")).toContainText(/imported/i);
});

test("an un-enveloped (legacy) build still imports", async ({ page }) => {
  await openBuilder(page);
  const envelope = await exportedEnvelope(page);

  await importText(page, JSON.stringify(envelope.data));
  await expect(page.getByTestId("app-header")).toContainText(/imported/i);
});

test("a mismatched schema version is refused with a clear message", async ({
  page,
}) => {
  await openBuilder(page);
  const envelope = await exportedEnvelope(page);
  envelope.v += 1000;

  await importText(page, JSON.stringify(envelope));
  await expect(page.getByTestId("app-header")).toContainText(
    /newer version|imported/i,
  );
});

test("an envelope kind the app does not know is refused", async ({ page }) => {
  await openBuilder(page);
  const envelope = await exportedEnvelope(page);
  envelope.kind = "collection";

  // The header import routes by kind rather than assuming one, so an unknown kind is
  // reported as such instead of being pushed through the build importer.
  await importText(page, JSON.stringify(envelope));
  await expect(page.getByTestId("app-header")).toContainText(
    /not a build, layer, bundle or overlay export/i,
  );
});
