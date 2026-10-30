// The header on a phone: one row of controls at every supported width, the overflow menu
// holding what the row has no room for, and a notice wrapping on a row of its own.
import { test, expect, type Locator, type Page } from "@playwright/test";
import { openBuilder } from "../support/app";
import {
  MIN_SUPPORTED_WIDTH,
  expectNoHorizontalScroll,
} from "../support/viewport";
import { buildRow, openRowMenu } from "../support/nav";

const header = (page: Page) => page.getByTestId("app-header");
const kebab = (page: Page) => page.getByTestId("header-menu");
const menuEntry = (page: Page, action: string) =>
  page.getByTestId(`header-menu-${action}`);

/** The header's visible controls, nav toggle through overflow menu. */
const ROW = [
  "header-nav-toggle",
  "header-title",
  "header-go-to",
  "autosave-indicator",
  "header-menu",
];

async function box(locator: Locator) {
  const b = await locator.boundingBox();
  if (!b) throw new Error("Not visible");
  return b;
}

/** Every control shares one row: their vertical centers line up within a pixel or two. */
async function expectOneRow(page: Page) {
  const centers = await Promise.all(
    ROW.map(async (id) => {
      const b = await box(page.getByTestId(id));
      return b.y + b.height / 2;
    }),
  );
  for (const center of centers)
    expect(Math.abs(center - centers[0])).toBeLessThanOrEqual(2);
}

/** Nothing in the header reaches past its own width. */
async function expectHeaderFits(page: Page) {
  const { scrollWidth, clientWidth } = await header(page).evaluate((el) => ({
    scrollWidth: el.scrollWidth,
    clientWidth: el.clientWidth,
  }));
  expect(scrollWidth).toBeLessThanOrEqual(clientWidth);
}

for (const width of [MIN_SUPPORTED_WIDTH, 412]) {
  test(`the header fits on one row at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    await openBuilder(page);

    await expectOneRow(page);
    const menuBox = await box(kebab(page));
    expect(menuBox.x + menuBox.width).toBeLessThanOrEqual(width);
    await expectHeaderFits(page);
    // The mark alone: the name is left to screen readers.
    expect((await box(page.getByTestId("header-title"))).width).toBe(32);
    await expect(page.getByTestId("header-go-to").locator("kbd")).toBeHidden();
    await expect(page.getByTestId("header-shortcuts")).toHaveCount(0);

    // The editor pane's toolbar is not yet fitted to 360px, so the page-wide check runs on
    // the stats pane.
    await page.getByTestId("pane-stats").click();
    await expectNoHorizontalScroll(page);
  });
}

test("the overflow menu leaves out keyboard shortcuts on a touch screen", async ({
  page,
}) => {
  await openBuilder(page);
  await kebab(page).click();

  for (const action of [
    "export",
    "import",
    "importFromGame",
    "stable",
    "about",
    "theme",
  ])
    await expect(menuEntry(page, action)).toBeVisible();
  await expect(menuEntry(page, "shortcuts")).toHaveCount(0);
  await expectNoHorizontalScroll(page);
});

test("About opens from the overflow menu and hands focus back to it", async ({
  page,
}) => {
  await openBuilder(page);
  await kebab(page).click();
  await menuEntry(page, "about").click();

  const dialog = page.getByTestId("about-dialog");
  await expect(dialog).toBeVisible();
  await expect(menuEntry(page, "about")).toHaveCount(0);

  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(kebab(page)).toBeFocused();
});

test("the theme entry cycles the theme and keeps the menu open", async ({
  page,
}) => {
  await openBuilder(page);
  await kebab(page).click();

  await expect(menuEntry(page, "theme")).toHaveText("Theme: System");
  await menuEntry(page, "theme").click();
  await expect(menuEntry(page, "theme")).toHaveText("Theme: Light");
  await menuEntry(page, "theme").click();
  await expect(menuEntry(page, "theme")).toHaveText("Theme: Dark");
  await expect(page.locator("html")).toHaveClass(/dark/);
});

test("the remaining menu entries open what their bar buttons open", async ({
  page,
}) => {
  await openBuilder(page);

  await kebab(page).click();
  await menuEntry(page, "export").click();
  await expect(page.getByTestId("bundle-export-picker")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("bundle-export-picker")).toHaveCount(0);

  await kebab(page).click();
  await menuEntry(page, "stable").click();
  await expect(page.getByTestId("stable-browser")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("stable-browser")).toHaveCount(0);

  await kebab(page).click();
  await menuEntry(page, "importFromGame").click();
  await expect(page.getByTestId("game-import-modal")).toBeVisible();
});

test("search opens the go-to palette from its icon button", async ({
  page,
}) => {
  await openBuilder(page);
  await page.getByTestId("header-go-to").click();
  await expect(page.getByTestId("go-to-input")).toBeFocused();
});

test("a long notice wraps under the header row instead of truncating", async ({
  page,
}) => {
  await page.setViewportSize({ width: MIN_SUPPORTED_WIDTH, height: 800 });
  await openBuilder(page);

  const name = "A build with a name far too long to fit on one phone row";
  await page.getByTestId("header-nav-toggle").click();
  // Through the row menu: a tap on the name itself opens the build and closes the drawer.
  await (
    await openRowMenu(buildRow(page, "Build 1"))
  )
    .getByRole("button", { name: /Rename/ })
    .click();
  await page.locator(".nav-rename").fill(name);
  await page.locator(".nav-rename").press("Enter");
  const menu = await openRowMenu(buildRow(page, name));
  await menu.getByRole("button", { name: "Duplicate" }).click();

  const notice = page.getByTestId("header-notice");
  await expect(notice).toContainText(`Duplicated as “${name}`);

  // Below every other control, and wrapped rather than clipped.
  const noticeBox = await box(notice);
  const toggleBox = await box(page.getByTestId("header-nav-toggle"));
  expect(noticeBox.y).toBeGreaterThanOrEqual(toggleBox.y + toggleBox.height);
  const text = await notice
    .locator("span")
    .first()
    .evaluate((el) => ({
      scrollWidth: el.scrollWidth,
      clientWidth: el.clientWidth,
      height: el.getBoundingClientRect().height,
      lineHeight: parseFloat(getComputedStyle(el).lineHeight),
    }));
  expect(text.scrollWidth).toBeLessThanOrEqual(text.clientWidth);
  expect(text.height).toBeGreaterThan(text.lineHeight * 1.5);

  await expectOneRow(page);
  await expectHeaderFits(page);
});

for (const width of [768, 1000]) {
  test(`a tablet header keeps its file actions on one row at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await openBuilder(page);

    await expectOneRow(page);
    const rowCenter = async (id: string) => {
      const b = await box(page.getByTestId(id));
      return b.y + b.height / 2;
    };
    const center = await rowCenter("header-menu");
    for (const id of ["header-export-bundle", "header-import"])
      expect(Math.abs((await rowCenter(id)) - center)).toBeLessThanOrEqual(2);
    await expect(page.getByTestId("header-import-from-game")).toHaveCount(0);
    await expect(page.getByTestId("header-about")).toHaveCount(0);
    await expectHeaderFits(page);
    await expectNoHorizontalScroll(page);
  });
}
