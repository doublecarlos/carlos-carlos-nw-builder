// The shortcut overlay: how it opens, how it gives focus back, and the guard that keeps `?`
// from hijacking a keystroke meant for a text field.
import { test, expect } from "@playwright/test";
import { openBuilder, slotFilterInput, blurToHeader } from "./support/app";

const overlay = (page: import("@playwright/test").Page) =>
  page.getByTestId("shortcut-help");

test("? opens the overlay", async ({ page }) => {
  await openBuilder(page);
  await blurToHeader(page);

  await page.keyboard.press("Shift+Slash");

  await expect(overlay(page)).toBeVisible();
});

test("? types a character instead, while a field has focus", async ({
  page,
}) => {
  await openBuilder(page);
  await slotFilterInput(page).click();

  await page.keyboard.press("Shift+Slash");

  await expect(overlay(page)).toBeHidden();
  await expect(slotFilterInput(page)).toHaveValue("?");
});

test("the header button opens it too, so it isn't a secret", async ({
  page,
}) => {
  await openBuilder(page);

  await page.getByTestId("header-shortcuts").click();

  await expect(overlay(page)).toBeVisible();
});

test("Escape closes it and hands focus back", async ({ page }) => {
  await openBuilder(page);
  const trigger = page.getByTestId("header-shortcuts");
  await trigger.click();
  await expect(overlay(page)).toBeVisible();

  await page.keyboard.press("Escape");

  await expect(overlay(page)).toBeHidden();
  await expect(trigger).toBeFocused();
});

test("clicking outside the panel closes it", async ({ page }) => {
  await openBuilder(page);
  await page.getByTestId("header-shortcuts").click();

  // The backdrop, not the panel -- `@click.self` is what distinguishes them.
  await overlay(page).click({ position: { x: 5, y: 5 } });

  await expect(overlay(page)).toBeHidden();
});

test("it lists a shortcut for every context, with this platform's modifier", async ({
  page,
}) => {
  await openBuilder(page);
  await page.getByTestId("header-shortcuts").click();

  await expect(page.getByTestId("shortcut-group-global")).toBeVisible();
  await expect(page.getByTestId("shortcut-group-nav")).toBeVisible();
  await expect(page.getByTestId("shortcut-group-slots")).toBeVisible();
  await expect(page.getByTestId("shortcut-group-pickers")).toBeVisible();

  // One modifier, not both spellings: the overlay resolves `Mod` for the platform it is on.
  const global = page.getByTestId("shortcut-group-global");
  await expect(global.getByText("Ctrl", { exact: true }).first()).toBeVisible();
  await expect(global.getByText("⌘", { exact: true })).toHaveCount(0);
});

test("the bindings are no longer restated as inline hints", async ({
  page,
}) => {
  await openBuilder(page);

  // These lived permanently in the nav and the editor toolbar, and are the space the overlay
  // buys back. They also drifted -- which is the reason the list has one home now.
  await expect(page.getByText("F2 rename")).toHaveCount(0);
  await expect(
    page.getByText("click a filled slot to edit in a layer"),
  ).toHaveCount(0);
});
