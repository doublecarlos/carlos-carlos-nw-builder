// The motion budget, checked with motion turned back on (the suite runs with reduced motion):
// overlays enter with a short animation, repeated actions do not replay it, and nothing an
// entrance does gets in the way of input.
import { test, expect, type Locator, type Page } from "@playwright/test";
import {
  openBuilder,
  chooseItem,
  slotRow,
  pickerInput,
  headerRow,
  hoverForCard,
} from "./support/app";
import { buildRow } from "./support/nav";
import { shippedItemName } from "./support/shippedData";

const HEAD_ITEM = shippedItemName("m29-enchanted-depthweave-cap-ca");

/** The entrance on `target` or its nearest animated ancestor, read from computed style rather
 *  than `getAnimations()`, which drops an animation as soon as it finishes. */
function entrance(target: Locator) {
  return target.evaluate((el) => {
    for (let node: Element | null = el; node; node = node.parentElement) {
      const style = getComputedStyle(node);
      if (style.animationName !== "none") {
        return {
          name: style.animationName,
          ms: parseFloat(style.animationDuration) * 1000,
        };
      }
    }
    return null;
  });
}

/** Whether `target` enters with an animation inside the 200ms budget. */
async function entersWithinBudget(target: Locator) {
  const found = await entrance(target);
  return !!found && found.ms > 0 && found.ms <= 200;
}

const card = (page: Page) => page.locator(".itemcard");

test.describe("with motion", () => {
  test.use({ contextOptions: { reducedMotion: "no-preference" } });

  test("a menu, a tooltip and a modal each enter within budget", async ({
    page,
  }) => {
    await openBuilder(page);

    await buildRow(page, "Build 1").locator(".nav-kebab").click();
    expect(await entersWithinBudget(page.locator(".navmenu"))).toBe(true);
    await page.keyboard.press("Escape");

    await page.locator(".stat-info-btn").first().focus();
    expect(await entersWithinBudget(page.getByTestId("tooltip"))).toBe(true);

    await page.getByTestId("header-import-from-game").click();
    expect(
      await entersWithinBudget(
        page.getByRole("dialog", { name: "Import from game" }),
      ),
    ).toBe(true);
  });

  test("the hover card fades in once, not again while sweeping the list", async ({
    page,
  }) => {
    await openBuilder(page);
    await chooseItem(page, "gear.head", HEAD_ITEM);

    await hoverForCard(page, slotRow(page, "gear.head"));
    await expect(card(page)).toBeVisible();
    expect(await entersWithinBudget(card(page))).toBe(true);

    // Leaving closes the card; coming back inside the resume window reopens it with no
    // entrance, the same path as landing on the next row of a sweep.
    await page.mouse.move(0, 0);
    await expect(card(page)).toBeHidden();
    await slotRow(page, "gear.head").hover();
    await expect(card(page)).toBeVisible();
    expect(await entrance(card(page))).toBeNull();
  });

  test("typing right after opening the palette lands every character", async ({
    page,
  }) => {
    await openBuilder(page);

    await page.keyboard.press("ControlOrMeta+k");
    await page.keyboard.type("pants");

    await expect(page.getByTestId("go-to-input")).toHaveValue("pants");
  });

  test("a picker opened in a section that just faded in sits under its input", async ({
    page,
  }) => {
    await openBuilder(page);
    await headerRow(page, "gear").click();
    await headerRow(page, "gear").click();

    const input = pickerInput(slotRow(page, "gear.head"));
    await input.click();
    const menu = page.getByTestId("picker-menu");
    await expect(menu).toBeVisible();

    // Against the viewport, whichever side it opened on. A transformed ancestor would shift it.
    const inputBox = (await input.boundingBox())!;
    const menuBox = (await menu.boundingBox())!;
    expect(Math.abs(menuBox.x - inputBox.x)).toBeLessThan(2);
    const gapBelow = menuBox.y - (inputBox.y + inputBox.height);
    const gapAbove = inputBox.y - (menuBox.y + menuBox.height);
    expect(Math.min(Math.abs(gapBelow), Math.abs(gapAbove))).toBeLessThan(6);
  });
});

test.describe("with reduced motion", () => {
  test("entrances collapse to effectively nothing", async ({ page }) => {
    await openBuilder(page);

    await page.getByTestId("header-import-from-game").click();
    const found = await entrance(
      page.getByRole("dialog", { name: "Import from game" }),
    );
    expect(found?.ms ?? 0).toBeLessThan(1);
  });
});
