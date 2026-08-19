// BaseTooltip, driven through the real app rather than in isolation -- the things that make it
// worth having over a native `title` are all behavioural: it shows on keyboard focus, it can be
// dismissed, and it does not linger over whatever a click just opened.
import { test, expect } from "@playwright/test";
import { openBuilder } from "./support/app";

/** A stat row's info button: an icon-only control whose whole label lives in its tooltip,
 *  which is exactly the case native `title` served worst. */
const infoButton = (page: import("@playwright/test").Page) =>
  page.locator(".stat-info-btn").first();

const tooltip = (page: import("@playwright/test").Page) =>
  page.getByTestId("tooltip");

test("a tooltip opens on hover and closes when the pointer leaves", async ({
  page,
}) => {
  await openBuilder(page);

  await infoButton(page).hover();
  await expect(tooltip(page)).toHaveText("Show contributing sources");

  await page.getByTestId("app-header").hover();
  await expect(tooltip(page)).toBeHidden();
});

test("a tooltip opens on keyboard focus, which `title` never did", async ({
  page,
}) => {
  await openBuilder(page);

  await infoButton(page).focus();

  await expect(tooltip(page)).toBeVisible();
});

test("Escape dismisses a tooltip", async ({ page }) => {
  await openBuilder(page);

  await infoButton(page).focus();
  await expect(tooltip(page)).toBeVisible();

  await page.keyboard.press("Escape");

  await expect(tooltip(page)).toBeHidden();
});

test("the tooltip describes its trigger while open", async ({ page }) => {
  await openBuilder(page);
  const button = infoButton(page);

  await button.focus();

  await expect(tooltip(page)).toBeVisible();

  // Described-by, not labelled-by: it explains the control rather than naming it. The two ids
  // are compared inside the page rather than through a local, both because the linkage is the
  // actual claim and because a `const x = await locator.getAttribute(...)` local is what
  // eslint-plugin-playwright's `prefer-web-first-assertions` autofix mistakes for a locator.
  const linked = await page.evaluate(() => {
    const trigger = document.querySelector("[aria-describedby]");
    const bubble = document.querySelector('[data-testid="tooltip"]');
    return (
      !!trigger &&
      !!bubble &&
      trigger.getAttribute("aria-describedby") === bubble.id
    );
  });
  expect(linked).toBe(true);

  await page.keyboard.press("Escape");
  // A stale pointer at a removed element says nothing, so the attribute goes with the bubble.
  await expect(button).not.toHaveAttribute("aria-describedby", /./);
});

test("only one tooltip shows at a time", async ({ page }) => {
  await openBuilder(page);
  const buttons = page.locator(".stat-info-btn");

  await buttons.nth(0).hover();
  await expect(tooltip(page)).toBeVisible();
  await buttons.nth(1).hover();

  await expect(tooltip(page)).toHaveCount(1);
});

test("clicking a trigger dismisses its tooltip, so it can't cover what opened", async ({
  page,
}) => {
  await openBuilder(page);
  const button = infoButton(page);

  await button.hover();
  await expect(tooltip(page)).toBeVisible();

  await button.click();

  await expect(tooltip(page)).toBeHidden();
  // The click's own popover is what should be on screen now.
  await expect(page.getByTestId("stat-card-title")).toBeVisible();
});

test("wrapping a control leaves its layout and classes alone", async ({
  page,
}) => {
  await openBuilder(page);

  // BaseTooltip's wrapper is `display: contents`, and IconButton re-binds `$attrs` onto the
  // button -- together that keeps a caller's layout classes on the element that must carry
  // them. Without either, `flex-none` would land on a wrapper and the row would reflow.
  const button = page.locator(".stat-info-btn").first();
  await expect(button).toHaveClass(/flex-none/);
  expect(
    await button.evaluate(
      (el) => getComputedStyle(el.parentElement!).display === "contents",
    ),
  ).toBe(true);
});

/** Horizontal overlap between two boxes, in px. */
function overlap(
  a: { x: number; width: number },
  b: { x: number; width: number },
) {
  return Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
}

test("a tooltip sits under its trigger, not beside it", async ({ page }) => {
  await openBuilder(page);
  // A trigger with room on both sides, so this measures the placement rather than the
  // viewport clamp -- the edge case has its own test below.
  const button = page.getByRole("button", { name: "Clear section" }).first();

  await button.hover();
  await expect(tooltip(page)).toBeVisible();

  const trigger = (await button.boundingBox())!;
  const bubble = (await tooltip(page).boundingBox())!;

  // Centred on the trigger, within a pixel of rounding.
  const triggerCentre = trigger.x + trigger.width / 2;
  const bubbleCentre = bubble.x + bubble.width / 2;
  expect(Math.abs(bubbleCentre - triggerCentre)).toBeLessThanOrEqual(1);
  expect(bubble.y).toBeGreaterThan(trigger.y);
});

test("a tooltip near the window edge stays on screen and still overlaps its trigger", async ({
  page,
}) => {
  await openBuilder(page);
  // The header's rightmost controls are the case that exposed this: placed beside their
  // anchor, the bubble flipped clear of the button and read as belonging to nothing.
  const button = page.getByTestId("header-shortcuts");

  await button.hover();
  await expect(tooltip(page)).toBeVisible();

  const trigger = (await button.boundingBox())!;
  const bubble = (await tooltip(page).boundingBox())!;
  const viewport = page.viewportSize()!;

  expect(bubble.x).toBeGreaterThanOrEqual(0);
  expect(bubble.x + bubble.width).toBeLessThanOrEqual(viewport.width);
  expect(overlap(trigger, bubble)).toBeGreaterThan(0);
});
