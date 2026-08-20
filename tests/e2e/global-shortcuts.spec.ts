// End-to-end coverage for useGlobalShortcuts: Ctrl+/ (focus the slot filter box while a build
// is being edited), plus the guard that keeps it from firing while a form control has focus.
import { test, expect } from "@playwright/test";
import { openBuilder, slotFilterInput, blurToHeader } from "./support/app";
import { buildRow } from "./support/nav";

test("Ctrl+/ focuses the slot filter while a build is selected", async ({
  page,
}) => {
  await openBuilder(page);
  await blurToHeader(page);

  await page.keyboard.press("Control+/");

  await expect(slotFilterInput(page)).toBeFocused();
});

test("Ctrl+/ does nothing while a form control has focus", async ({ page }) => {
  await openBuilder(page);
  await page.getByTestId("nav-builds-filter").click();

  await page.keyboard.press("Control+/");

  await expect(page.getByTestId("nav-builds-filter")).toBeFocused();
  await expect(slotFilterInput(page)).not.toBeFocused();
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
