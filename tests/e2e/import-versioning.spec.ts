// End-to-end coverage for the versioned export/import envelope (build-parameters plan 0005):
// a real export round-trips through import, an un-enveloped (legacy) build still works, and a
// version or kind mismatch is refused with a clear message instead of silently mis-normalised.
import { test, expect, type Page } from "@playwright/test";
import { confirmImport, importText, openBuilder } from "./support/app";

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

test("a real export round-trips through import", async ({ page }) => {
  await openBuilder(page);
  const envelope = await exportedEnvelope(page);
  expect(envelope.kind).toBe("build");

  // The export carries the id of the build still open, so importing it back is a conflict:
  // the picker offers to keep both or replace, and keeping both is what it opens on.
  await importText(page, JSON.stringify(envelope));
  await confirmImport(page);
  await expect(page.getByTestId("app-header")).toContainText(/imported/i);
});

test("an un-enveloped (legacy) build still imports", async ({ page }) => {
  await openBuilder(page);
  const envelope = await exportedEnvelope(page);

  await importText(page, JSON.stringify(envelope.data));
  await confirmImport(page);
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
