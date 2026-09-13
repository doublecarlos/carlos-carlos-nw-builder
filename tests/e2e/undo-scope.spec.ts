// End-to-end coverage for the undo scope: the app root reflects it as `data-undo-scope-active`,
// and it follows clicks and keyboard focus into the nav sidebar, the build editor, the layer
// editor and the stat panel, while chrome outside every region leaves it alone.
import { test, expect, type Page } from "@playwright/test";
import { blurToHeader, openBuilder, slotFilterInput } from "./support/app";
import { addLayer, layerRow } from "./support/nav";

function activeScope(page: Page) {
  return page.locator("[data-undo-scope-active]");
}

/** The focus bar along the top edge of the region that owns the undo scope. */
function focusBar(page: Page, scope: "nav" | "editor") {
  return page.getByTestId(`${scope}-focus-bar`);
}

function firstBuildName(page: Page) {
  return page
    .getByTestId("library")
    .locator(".nav-row--build")
    .first()
    .locator(".nav-name");
}

test("a fresh app starts in the editor scope", async ({ page }) => {
  await openBuilder(page);
  await expect(activeScope(page)).toHaveAttribute(
    "data-undo-scope-active",
    "editor",
  );
});

test("clicking a nav row moves the scope to the nav", async ({ page }) => {
  await openBuilder(page);
  await firstBuildName(page).click();
  await expect(activeScope(page)).toHaveAttribute(
    "data-undo-scope-active",
    "nav",
  );
});

test("clicking into the build editor moves the scope back to the editor", async ({
  page,
}) => {
  await openBuilder(page);
  await firstBuildName(page).click();
  await expect(activeScope(page)).toHaveAttribute(
    "data-undo-scope-active",
    "nav",
  );

  await slotFilterInput(page).click();
  await expect(activeScope(page)).toHaveAttribute(
    "data-undo-scope-active",
    "editor",
  );
});

test("clicking into the stat panel counts as the editor", async ({ page }) => {
  await openBuilder(page);
  await firstBuildName(page).click();
  await expect(activeScope(page)).toHaveAttribute(
    "data-undo-scope-active",
    "nav",
  );

  await page
    .getByTestId("details-sidebar")
    .getByRole("button", { name: "Stats", exact: true })
    .click();
  await expect(activeScope(page)).toHaveAttribute(
    "data-undo-scope-active",
    "editor",
  );
});

test("clicking the app header leaves the scope where it was", async ({
  page,
}) => {
  await openBuilder(page);
  await firstBuildName(page).click();
  await expect(activeScope(page)).toHaveAttribute(
    "data-undo-scope-active",
    "nav",
  );

  await blurToHeader(page);
  await expect(activeScope(page)).toHaveAttribute(
    "data-undo-scope-active",
    "nav",
  );
});

test("clicking into the layer editor moves the scope to the editor", async ({
  page,
}) => {
  await openBuilder(page);
  await addLayer(page);
  await layerRow(page, "Layer 1").locator(".nav-name").click();
  await expect(activeScope(page)).toHaveAttribute(
    "data-undo-scope-active",
    "nav",
  );

  await page.locator(".editor-search").click();
  await expect(activeScope(page)).toHaveAttribute(
    "data-undo-scope-active",
    "editor",
  );
});

test("tabbing into the nav moves the scope without a click", async ({
  page,
}) => {
  await openBuilder(page);
  // Focus parked on the header's last control: outside every region, so the scope stays put,
  // and one Tab away from the sidebar's first field.
  await page.getByTestId("app-header").locator("button").last().focus();
  await expect(activeScope(page)).toHaveAttribute(
    "data-undo-scope-active",
    "editor",
  );

  await page.keyboard.press("Tab");
  await expect(page.getByTestId("nav-builds-filter")).toBeFocused();
  await expect(activeScope(page)).toHaveAttribute(
    "data-undo-scope-active",
    "nav",
  );
});

test("the focused region is the one with the focus bar", async ({ page }) => {
  await openBuilder(page);
  await expect(focusBar(page, "editor")).toBeVisible();
  await expect(focusBar(page, "nav")).toHaveCount(0);

  // The top-left corner sits in the nav's own padding: part of the marked region, but on no
  // row, so the bar is the only cue that the scope moved here.
  await page.getByTestId("library").click({ position: { x: 4, y: 4 } });
  await expect(activeScope(page)).toHaveAttribute(
    "data-undo-scope-active",
    "nav",
  );
  await expect(page.locator("[data-nav-key]:focus")).toHaveCount(0);
  await expect(focusBar(page, "nav")).toBeVisible();
  await expect(focusBar(page, "editor")).toHaveCount(0);

  await slotFilterInput(page).click();
  await expect(focusBar(page, "editor")).toBeVisible();
  await expect(focusBar(page, "nav")).toHaveCount(0);
});
