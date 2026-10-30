// The app shell below the desktop breakpoint: the nav as an overlay drawer, the phone's
// Editor | Stats switch, the tablet's fixed stats column, and desktop rail widths surviving a
// trip through the narrow layouts.
import { test, expect, type Page } from "@playwright/test";
import { openBuilder } from "../support/app";
import {
  MIN_SUPPORTED_WIDTH,
  expectNoHorizontalScroll,
} from "../support/viewport";

const hamburger = (page: Page) => page.getByTestId("header-nav-toggle");
const drawer = (page: Page) => page.getByTestId("nav-drawer");
const drawerPanel = (page: Page) => drawer(page).getByRole("dialog");
const editorColumn = (page: Page) => page.getByTestId("editor-pane");
const statColumn = (page: Page) => page.getByTestId("stat-panel-column");

test("the nav is a drawer that closes on Escape and hands focus back", async ({
  page,
}) => {
  await openBuilder(page);
  await expect(page.getByTestId("nav-column")).toHaveCount(0);
  await expect(page.getByTestId("library")).toHaveCount(0);

  await hamburger(page).click();

  await expect(drawerPanel(page)).toBeFocused();
  await expect(page.getByTestId("library")).toBeVisible();
  await expect(hamburger(page)).toHaveAttribute("aria-expanded", "true");

  await page.keyboard.press("Escape");

  await expect(drawer(page)).toHaveCount(0);
  await expect(hamburger(page)).toBeFocused();
});

test("tapping the backdrop or the close button closes the drawer", async ({
  page,
}) => {
  await openBuilder(page);
  const width = page.viewportSize()!.width;

  await hamburger(page).click();
  await drawer(page).click({ position: { x: width - 10, y: 300 } });
  await expect(drawer(page)).toHaveCount(0);

  await hamburger(page).click();
  await drawer(page).getByTestId("sheet-close").click();
  await expect(drawer(page)).toHaveCount(0);
});

test("Tab stays inside the open drawer", async ({ page }) => {
  await openBuilder(page);
  await hamburger(page).click();

  for (let i = 0; i < 30; i++) {
    await page.keyboard.press("Tab");
    const inside = await page.evaluate(
      () =>
        !!document
          .querySelector('[data-testid="nav-drawer"]')
          ?.contains(document.activeElement),
    );
    expect(inside).toBe(true);
  }
});

test("picking a build in the drawer closes it and opens that build", async ({
  page,
}) => {
  await openBuilder(page);
  const firstBuild = new URL(page.url()).searchParams.get("build");

  // Creating a build selects it, which closes the drawer too.
  await hamburger(page).click();
  await page.getByTestId("nav-add-build").click();
  await expect(drawer(page)).toHaveCount(0);
  await expect
    .poll(() => new URL(page.url()).searchParams.get("build"))
    .not.toBe(firstBuild);

  await hamburger(page).click();
  await page.locator(".nav-row--build").first().click();

  await expect(drawer(page)).toHaveCount(0);
  await expect
    .poll(() => new URL(page.url()).searchParams.get("build"))
    .toBe(firstBuild);
});

test("the phone switches between the editor and the stats pane", async ({
  page,
}) => {
  await openBuilder(page);
  const editorTab = page.getByTestId("pane-editor");
  const statsTab = page.getByTestId("pane-stats");

  await expect(editorTab).toHaveAttribute("aria-pressed", "true");
  await expect(editorColumn(page)).toBeVisible();
  await expect(statColumn(page)).toBeHidden();

  await statsTab.click();

  await expect(statsTab).toHaveAttribute("aria-pressed", "true");
  await expect(editorColumn(page)).toBeHidden();
  await expect(statColumn(page)).toContainText("Ratings");
  await expect(page.getByTestId("rail-gutter-details")).toHaveCount(0);
  const viewportWidth = page.viewportSize()!.width;
  expect((await statColumn(page).boundingBox())!.width).toBe(viewportWidth);

  await editorTab.click();

  await expect(editorColumn(page)).toBeVisible();
  await expect(statColumn(page)).toBeHidden();
});

/** Opens the drawer, then the stats pane, checking neither pushes the page sideways. */
async function expectShellFits(page: Page) {
  await hamburger(page).click();
  await expectNoHorizontalScroll(page);
  await page.keyboard.press("Escape");

  await page.getByTestId("pane-stats").click();
  await expect(statColumn(page)).toContainText("Ratings");
  await expectNoHorizontalScroll(page);
}

test("the builder does not scroll sideways at the device width", async ({
  page,
}) => {
  await openBuilder(page);
  await expect(page.getByTestId("pane-switch")).toBeVisible();
  await expectNoHorizontalScroll(page);
  await expectShellFits(page);
});

// The editor pane's own content is not checked at this width yet: the build editor's toolbar
// still overflows it by a few pixels.
test("the drawer and stats pane fit the narrowest supported width", async ({
  page,
}) => {
  await page.setViewportSize({ width: MIN_SUPPORTED_WIDTH, height: 740 });
  await openBuilder(page);
  await expect(page.getByTestId("pane-switch")).toBeVisible();
  await expectShellFits(page);
});

test("a tablet keeps the stats beside the editor at a fixed width", async ({
  page,
}) => {
  await page.setViewportSize({ width: 900, height: 1000 });
  await openBuilder(page);

  await expect(page.getByTestId("pane-switch")).toHaveCount(0);
  await expect(page.getByTestId("rail-gutter-details")).toHaveCount(0);
  await expect(editorColumn(page)).toBeVisible();
  await expect(statColumn(page)).toContainText("Ratings");
  expect((await statColumn(page).boundingBox())!.width).toBe(360);

  await hamburger(page).click();
  await expect(page.getByTestId("library")).toBeVisible();
  await expectNoHorizontalScroll(page);
});

test("desktop rail widths survive a trip through the phone layout", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openBuilder(page);
  const nav = page.getByTestId("nav-column");
  await expect(hamburger(page)).toBeHidden();

  // Widen the nav by dragging its gutter.
  const box = (await page.getByTestId("rail-gutter-nav").boundingBox())!;
  const y = box.y + box.height / 2;
  await page.mouse.move(box.x + box.width / 2, y);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 80, y, { steps: 8 });
  await page.mouse.up();
  const navWidth = (await nav.boundingBox())!.width;
  const statsWidth = (await statColumn(page).boundingBox())!.width;

  await page.setViewportSize({ width: 412, height: 900 });
  await hamburger(page).click();
  await page.keyboard.press("Escape");
  await page.getByTestId("pane-stats").click();
  await expect(statColumn(page)).toContainText("Ratings");

  await page.setViewportSize({ width: 1440, height: 900 });

  await expect(nav).toBeVisible();
  expect((await nav.boundingBox())!.width).toBe(navWidth);
  expect((await statColumn(page).boundingBox())!.width).toBe(statsWidth);
  await expect(editorColumn(page)).toBeVisible();
});
