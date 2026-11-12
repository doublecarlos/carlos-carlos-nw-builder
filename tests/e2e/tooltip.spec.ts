// BaseTooltip, driven through the real app rather than in isolation -- the things that make it
// worth having over a native `title` are all behavioral: it shows on keyboard focus, it can be
// dismissed, and it does not linger over whatever a click just opened.
import { test, expect } from "@playwright/test";
import { addListRows, openBuilder } from "./support/app";
import { beginDrag } from "./support/dragDrop";

/** The header's About button: an icon-only control whose whole label lives in its tooltip,
 *  which is exactly the case native `title` served worst. Outside the build editor, whose
 *  row cursor moves focus on its own. */
const infoButton = (page: import("@playwright/test").Page) =>
  page.getByTestId("header-about");

const tooltip = (page: import("@playwright/test").Page) =>
  page.getByTestId("tooltip");

/** Focus as the keyboard gives it: a key goes down first, as with Tab, so the browser counts
 *  the focus that follows as `:focus-visible`. A bare `focus()` after a click does not. */
async function keyboardFocus(target: import("@playwright/test").Locator) {
  await target.page().keyboard.press("Shift");
  await target.focus();
}

test("a tooltip opens on hover and closes when the pointer leaves", async ({
  page,
}) => {
  await openBuilder(page);

  await infoButton(page).hover();
  await expect(tooltip(page)).toHaveText("About");

  await page.getByTestId("header-title").hover();
  await expect(tooltip(page)).toBeHidden();
});

test("a tooltip opens on keyboard focus, which `title` never did", async ({
  page,
}) => {
  await openBuilder(page);

  await keyboardFocus(infoButton(page));

  await expect(tooltip(page)).toBeVisible();
});

test("focus a script gives after a click opens no tooltip", async ({
  page,
}) => {
  await openBuilder(page);
  await page.getByTestId("app-header").click({ position: { x: 5, y: 5 } });

  // What a modal does on close, handing focus back to the control that opened it.
  await infoButton(page).focus();

  await expect(infoButton(page)).toBeFocused();
  await expect(tooltip(page)).toHaveCount(0);
});

test("Escape dismisses a tooltip", async ({ page }) => {
  await openBuilder(page);

  await keyboardFocus(infoButton(page));
  await expect(tooltip(page)).toBeVisible();

  await page.keyboard.press("Escape");

  await expect(tooltip(page)).toBeHidden();
});

test("the tooltip describes its trigger while open", async ({ page }) => {
  await openBuilder(page);
  const button = infoButton(page);

  await keyboardFocus(button);

  await expect(tooltip(page)).toBeVisible();

  // Described-by, not labeled-by: it explains the control rather than naming it. The two ids
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

test("scrolling any panel dismisses an open tooltip", async ({ page }) => {
  await openBuilder(page);

  // The header trigger stays put while the editor scrolls, so only the scroll can close it.
  await infoButton(page).hover();
  await expect(tooltip(page)).toBeVisible();

  await page.locator("main").evaluate((el) => el.scrollBy(0, 200));

  await expect(tooltip(page)).toBeHidden();
});

test("only one tooltip shows at a time", async ({ page }) => {
  await openBuilder(page);
  await page.getByTestId("header-shortcuts").hover();
  await expect(tooltip(page)).toBeVisible();
  await infoButton(page).hover();

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
  // The click's own dialog is what should be on screen now.
  await expect(page.getByTestId("about-dialog")).toBeVisible();
});

// A drag captures the pointer on its grip and never clicks, so the grip's tooltip would
// otherwise ride along for the whole drag, and every grip passed over would open its own.
test("dragging from a grip closes its tooltip and opens no other on the way", async ({
  page,
}) => {
  await page.clock.install();
  await openBuilder(page);
  await addListRows(page, "misc.misc", 2);
  const grip = (row: number) => page.getByTestId(`list-drag:misc.misc#${row}`);

  await grip(1).hover();
  await page.clock.runFor(1000);
  await expect(tooltip(page)).toBeVisible();

  const drag = await beginDrag(grip(1));
  await expect(tooltip(page)).toBeHidden();
  await drag.over(grip(2));
  await page.clock.runFor(1000);
  await expect(tooltip(page)).toBeHidden();
  await drag.end();
});

test("wrapping a control leaves its layout and classes alone", async ({
  page,
}) => {
  await openBuilder(page);

  // BaseTooltip's wrapper is `display: contents`, and IconButton re-binds `$attrs` onto the
  // button -- together that keeps a caller's layout classes on the element that must carry
  // them. Without either, the menu's own trigger class would land on a wrapper.
  const button = page.getByTestId("section-actions-gear");
  await expect(button).toHaveClass(/section-actions-gear/);
  expect(
    await button.evaluate(
      // eslint-disable-next-line no-restricted-syntax
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
  const button = page.getByTestId("section-actions-gear");

  await button.hover();
  await expect(tooltip(page)).toBeVisible();

  const trigger = (await button.boundingBox())!;
  const bubble = (await tooltip(page).boundingBox())!;

  // Centered on the trigger, within a pixel of rounding.
  const triggerCenter = trigger.x + trigger.width / 2;
  const bubbleCenter = bubble.x + bubble.width / 2;
  expect(Math.abs(bubbleCenter - triggerCenter)).toBeLessThanOrEqual(1);
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

test("a long tooltip wraps instead of running off the viewport", async ({
  page,
}) => {
  await openBuilder(page);

  // The Customization Layers heading explains the bottom-to-top ordering in a full sentence.
  await page.getByText("Customization Layers").hover();
  await expect(tooltip(page)).toBeVisible();

  const bubble = (await tooltip(page).locator("..").boundingBox())!;
  expect(bubble.x).toBeGreaterThanOrEqual(0);
  expect(bubble.x + bubble.width).toBeLessThanOrEqual(
    page.viewportSize()!.width,
  );
});
