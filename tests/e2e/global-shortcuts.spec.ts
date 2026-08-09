// End-to-end coverage for useGlobalShortcuts: Ctrl+N (new build) and / (focus the
// context-relevant filter box), plus the guard that keeps both from firing while a form
// control has focus.
import { test, expect } from "@playwright/test";
import { openBuilder, slotFilterInput } from "./support/app";
import { addLayer, buildRow } from "./support/nav";

test("Ctrl+N creates a new build and selects it", async ({ page }) => {
  await openBuilder(page);
  // Click the header to move focus off any input first, matching undo.spec's pattern for
  // reaching the global shortcut instead of a focused field's native behavior.
  await page.getByTestId("app-header").click();

  await page.keyboard.press("Control+n");

  const created = buildRow(page, "Build 2");
  await expect(created).toBeVisible();
  await expect(created).toHaveClass(/is-active/);
});

test("Ctrl+N does nothing while a form control has focus", async ({ page }) => {
  await openBuilder(page);
  await page.getByTestId("nav-builds-filter").click();

  await page.keyboard.press("Control+n");

  await expect(buildRow(page, "Build 2")).toHaveCount(0);
});

test("/ focuses the slot filter while a build is selected", async ({
  page,
}) => {
  await openBuilder(page);
  await page.getByTestId("app-header").click();

  await page.keyboard.press("/");

  await expect(slotFilterInput(page)).toBeFocused();
});

test("/ focuses the builds filter while a layer is selected", async ({
  page,
}) => {
  await openBuilder(page);
  await addLayer(page);
  await page.getByTestId("app-header").click();

  await page.keyboard.press("/");

  await expect(page.getByTestId("nav-builds-filter")).toBeFocused();
});

test("/ types a literal slash instead of stealing focus while renaming", async ({
  page,
}) => {
  await openBuilder(page);
  const row = buildRow(page, "Build 1");
  await row.locator(".nav-name").dblclick();

  // The rename input selects all its text on mount (see NavBuilds.vue's vRenameFocus), so
  // typing "/" replaces the selection rather than appending to it -- same as the existing
  // "rename input auto-focuses and selects all text" case in nav.spec.ts.
  const input = page.locator(".nav-rename");
  await expect(input).toBeFocused();
  await input.press("/");

  await expect(input).toBeFocused();
  await expect(input).toHaveValue("/");
});
