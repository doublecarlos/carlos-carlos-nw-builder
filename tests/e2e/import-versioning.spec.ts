// End-to-end coverage for the versioned export/import envelope (build-parameters plan 0005):
// a real export round-trips through import, an un-enveloped (legacy) build still works, and a
// version or kind mismatch is refused with a clear message instead of silently mis-normalised.
import { test, expect, type Page } from "@playwright/test";
import { openBuilder } from "./support/app";

async function openIoPanel(page: Page) {
  await page.getByRole("button", { name: /Import \/ export/ }).click();
}

async function exportedEnvelope(page: Page) {
  const text = await page.locator("textarea[readonly]").inputValue();
  return JSON.parse(text);
}

async function fillImport(page: Page, text: string) {
  await page
    .getByPlaceholder("Paste a build, or an array of builds…")
    .fill(text);
  await page
    .getByTestId("build-header")
    .getByRole("button", { name: "Import", exact: true })
    .click();
}

test("a real export round-trips through import", async ({ page }) => {
  await openBuilder(page);
  await openIoPanel(page);
  const envelope = await exportedEnvelope(page);
  expect(envelope.kind).toBe("build");

  await fillImport(page, JSON.stringify(envelope));
  await expect(page.locator("p.text-ok")).toBeVisible();
});

test("an un-enveloped (legacy) build still imports", async ({ page }) => {
  await openBuilder(page);
  await openIoPanel(page);
  const envelope = await exportedEnvelope(page);

  await fillImport(page, JSON.stringify(envelope.data));
  await expect(page.locator("p.text-ok")).toBeVisible();
});

test("a mismatched schema version is refused with a clear message", async ({
  page,
}) => {
  await openBuilder(page);
  await openIoPanel(page);
  const envelope = await exportedEnvelope(page);
  envelope.v += 1000;

  await fillImport(page, JSON.stringify(envelope));
  await expect(page.getByText(/newer version/i)).toBeVisible();
});

test("a collection bundle imported as a single build is refused as the wrong kind", async ({
  page,
}) => {
  await openBuilder(page);
  await openIoPanel(page);
  const envelope = await exportedEnvelope(page);
  envelope.kind = "collection";

  await fillImport(page, JSON.stringify(envelope));
  await expect(page.getByText(/not a "build"/i)).toBeVisible();
});
