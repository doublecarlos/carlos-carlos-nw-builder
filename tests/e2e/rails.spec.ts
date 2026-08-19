// Collapsible side rails: the width they hand back is the whole point, so these measure it
// rather than just checking a class.
import { test, expect } from "@playwright/test";
import { openBuilder } from "./support/app";

const navColumn = (page: import("@playwright/test").Page) =>
  page.getByTestId("nav-column");
const statColumn = (page: import("@playwright/test").Page) =>
  page.getByTestId("stat-panel-column");

const navToggle = (page: import("@playwright/test").Page) =>
  navColumn(page).getByTestId("rail-toggle-left");
const statToggle = (page: import("@playwright/test").Page) =>
  statColumn(page).getByTestId("rail-toggle-right");

async function widthOf(locator: import("@playwright/test").Locator) {
  return (await locator.boundingBox())!.width;
}

test("collapsing the nav hides its content and narrows the column", async ({
  page,
}) => {
  await openBuilder(page);
  const before = await widthOf(navColumn(page));
  await expect(page.getByTestId("library")).toBeVisible();

  await navToggle(page).click();

  await expect(page.getByTestId("library")).toBeHidden();
  expect(await widthOf(navColumn(page))).toBeLessThan(before);
});

test("restoring a rail brings its content back", async ({ page }) => {
  await openBuilder(page);
  await statToggle(page).click();
  await expect(statColumn(page).getByRole("tab", { name: /Stats/ })).toBeHidden(
    { timeout: 5000 },
  );

  await statToggle(page).click();

  await expect(statColumn(page)).toContainText("Ratings");
});

test("a collapsed rail stays collapsed across a reload", async ({ page }) => {
  await openBuilder(page);
  await navToggle(page).click();
  await expect(page.getByTestId("library")).toBeHidden();

  await page.reload();

  // A view preference, so it survives the way the open/closed sections already do.
  await expect(page.getByTestId("library")).toBeHidden();
  await expect(navToggle(page)).toHaveAttribute("aria-expanded", "false");
});

test("with both rails collapsed the page does not scroll sideways at 1024px", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1024, height: 800 });
  await openBuilder(page);

  await navToggle(page).click();
  await statToggle(page).click();

  // The reason the rails collapse at all: at 1100px the three columns already squeeze, and
  // below it the whole page scrolled with the stat panel's last column cut off.
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
});

test("the toggles are reachable and operable from the keyboard", async ({
  page,
}) => {
  await openBuilder(page);

  await navToggle(page).focus();
  await expect(navToggle(page)).toBeFocused();
  await page.keyboard.press("Enter");

  await expect(page.getByTestId("library")).toBeHidden();
});

test("the layer editor's entry list collapses too", async ({ page }) => {
  await openBuilder(page);
  await page.getByTestId("nav-add-layer").click();

  const toggle = page.getByRole("button", { name: "Hide the entry list" });
  await expect(toggle).toBeVisible();

  await toggle.click();

  await expect(page.getByTestId("layer-entries-collapsed")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Show the entry list" }),
  ).toBeVisible();
});
