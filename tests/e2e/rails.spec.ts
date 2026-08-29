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

/** Drags a rail's gutter horizontally, from its middle so the toggle button is nowhere near. */
async function dragGutter(
  page: import("@playwright/test").Page,
  rail: string,
  dx: number,
) {
  const box = (await page.getByTestId(`rail-gutter-${rail}`).boundingBox())!;
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx, y, { steps: 8 });
  await page.mouse.up();
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

test("dragging the nav's gutter widens the rail", async ({ page }) => {
  await openBuilder(page);
  const before = await widthOf(navColumn(page));

  await dragGutter(page, "nav", 80);

  expect(await widthOf(navColumn(page))).toBeCloseTo(before + 80, -1);
});

test("dragging the stat panel's gutter widens it the other way", async ({
  page,
}) => {
  await openBuilder(page);
  const before = await widthOf(statColumn(page));

  // A right-hand rail grows as its edge moves left.
  await dragGutter(page, "details", -80);

  expect(await widthOf(statColumn(page))).toBeCloseTo(before + 80, -1);
});

test("a rail cannot be dragged narrower than its minimum", async ({ page }) => {
  await openBuilder(page);

  await dragGutter(page, "nav", -600);

  // Narrow enough to be worth dragging to, wide enough to still show something.
  expect(await widthOf(navColumn(page))).toBe(180);
  await expect(page.getByTestId("library")).toBeVisible();
});

test("double-clicking a gutter restores the default width", async ({
  page,
}) => {
  await openBuilder(page);
  const original = await widthOf(navColumn(page));
  await dragGutter(page, "nav", 120);
  expect(await widthOf(navColumn(page))).toBeGreaterThan(original);

  await page.getByTestId("rail-gutter-nav").dblclick();

  expect(await widthOf(navColumn(page))).toBe(original);
});

test("the gutter resizes from the keyboard", async ({ page }) => {
  await openBuilder(page);
  const before = await widthOf(navColumn(page));

  await page.getByTestId("rail-gutter-nav").focus();
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");

  expect(await widthOf(navColumn(page))).toBe(before + 32);
});

test("a dragged width survives a reload", async ({ page }) => {
  await openBuilder(page);
  await dragGutter(page, "nav", 60);
  const dragged = await widthOf(navColumn(page));

  await page.reload();
  await expect(page.getByTestId("library")).toBeVisible();

  expect(await widthOf(navColumn(page))).toBe(dragged);
});

test("a width dragged out on a wide window is reined in on a narrow one", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1600, height: 900 });
  await openBuilder(page);
  await dragGutter(page, "details", -400);
  const wide = await widthOf(statColumn(page));

  await page.setViewportSize({ width: 1024, height: 900 });

  // The editor's floor and the nav's strip have to survive whatever the rail was dragged to.
  expect(await widthOf(statColumn(page))).toBeLessThan(wide);
  expect(await widthOf(statColumn(page))).toBeLessThanOrEqual(1024 - 380);
});

test("the toggle sits in the gutter rather than a row of its own", async ({
  page,
}) => {
  await openBuilder(page);

  // Both states put the button on the rail's inner edge, so it is where the user left it.
  const gutter = (await page.getByTestId("rail-gutter-nav").boundingBox())!;
  const toggle = (await navToggle(page).boundingBox())!;
  expect(toggle.x).toBeGreaterThan(gutter.x - toggle.width);
  expect(toggle.x).toBeLessThan(gutter.x + gutter.width);

  // And the list starts at the top of the rail: no strip above it any more.
  const list = (await page.getByTestId("library").boundingBox())!;
  expect(list.y).toBeLessThanOrEqual(gutter.y + 4);
});

test("the layer editor's entry list resizes too", async ({ page }) => {
  await openBuilder(page);
  await page.getByTestId("nav-add-layer").click();
  const list = page.getByTestId("layer-entries-column");
  const before = await widthOf(list);

  await dragGutter(page, "layerEntries", 90);

  expect(await widthOf(list)).toBeCloseTo(before + 90, -1);
});
