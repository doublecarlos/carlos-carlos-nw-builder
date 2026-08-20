// What every modal surface gets for free from BaseModal, exercised on the "Import from game"
// wizard -- one of the two that had none of it before the consolidation.
import { test, expect, type Page } from "@playwright/test";
import { openBuilder } from "./support/app";

const wizard = (page: Page) => page.getByTestId("game-import-modal");
const trigger = (page: Page) => page.getByTestId("header-import-from-game");

/** Whether focus is currently inside the dialog -- what "trapped" actually means. */
const focusIsInDialog = (page: Page) =>
  page.evaluate(
    () =>
      !!document.activeElement?.closest('[role="dialog"][aria-modal="true"]'),
  );

test("it is announced as a dialog with a name", async ({ page }) => {
  await openBuilder(page);

  await trigger(page).click();

  await expect(
    page.getByRole("dialog", { name: "Import from game" }),
  ).toBeVisible();
});

test("Escape closes it and hands focus back to whatever opened it", async ({
  page,
}) => {
  await openBuilder(page);
  await trigger(page).click();
  await expect(wizard(page)).toBeVisible();

  await page.keyboard.press("Escape");

  await expect(wizard(page)).toBeHidden();
  await expect(trigger(page)).toBeFocused();
});

test("the close button hands focus back too", async ({ page }) => {
  await openBuilder(page);
  await trigger(page).click();

  await page.getByTestId("modal-close").click();

  await expect(wizard(page)).toBeHidden();
  await expect(trigger(page)).toBeFocused();
});

test("Tab cannot leave the dialog", async ({ page }) => {
  await openBuilder(page);
  await trigger(page).click();
  await expect(wizard(page)).toBeVisible();

  // More presses than the wizard has controls, so this wraps rather than merely not having
  // reached the edge yet.
  for (let i = 0; i < 8; i++) {
    await page.keyboard.press("Tab");
    expect(await focusIsInDialog(page)).toBe(true);
  }

  // And backwards off the front edge, which is the direction a naive trap gets wrong.
  for (let i = 0; i < 8; i++) {
    await page.keyboard.press("Shift+Tab");
    expect(await focusIsInDialog(page)).toBe(true);
  }
});

test("the page behind it does not scroll, and scrolls again after", async ({
  page,
}) => {
  await openBuilder(page);
  await trigger(page).click();
  await expect(wizard(page)).toBeVisible();

  await expect(page.locator("body")).toHaveCSS("overflow", "hidden");

  await page.keyboard.press("Escape");
  await expect(wizard(page)).toBeHidden();
  await expect(page.locator("body")).not.toHaveCSS("overflow", "hidden");
});

test("clicking the backdrop dismisses it", async ({ page }) => {
  await openBuilder(page);
  await trigger(page).click();

  // The backdrop, not the panel -- `@click.self` is what distinguishes them.
  await wizard(page).click({ position: { x: 5, y: 5 } });

  await expect(wizard(page)).toBeHidden();
});
