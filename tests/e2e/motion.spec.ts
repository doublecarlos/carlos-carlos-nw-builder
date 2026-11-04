// The motion budget, checked with motion turned back on (the suite runs with reduced motion):
// overlays enter with a short animation, repeated actions do not replay it, and nothing an
// entrance does gets in the way of input. Folding a section slides the ones below it, and a
// rail collapses through a view transition that captures only the rails.
import { test, expect, type Page } from "@playwright/test";
import {
  openBuilder,
  chooseItem,
  slotRow,
  pickerInput,
  headerRow,
  hoverForCard,
} from "./support/app";
import { buildRow } from "./support/nav";
import { entrance, entersWithinBudget } from "./support/motion";
import { shippedItemName } from "./support/shippedData";

const HEAD_ITEM = shippedItemName("m29-enchanted-depthweave-cap-ca");

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

    await page.getByTestId("header-shortcuts").hover();
    await expect(page.getByTestId("tooltip")).toBeVisible();
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
    // The whole floating shell, footer included, not just its listbox.
    const menu = page.getByTestId("picker-shell");
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

/** The view transition groups animating right now, by name. */
function morphingGroups(page: Page) {
  return page.evaluate(() =>
    document
      .getAnimations()
      .map((a) => (a.effect as KeyframeEffect | null)?.pseudoElement ?? "")
      .flatMap((p) => /^::view-transition-group\((.+)\)$/.exec(p)?.[1] ?? []),
  );
}

/** The section ids sliding right now. */
function slidingSections(page: Page) {
  return page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>("[data-section-id]")]
      .filter((el) => el.getAnimations().some((a) => a.id === "row-slide"))
      .map((el) => el.dataset.sectionId),
  );
}

/** The section ids in list order. */
function sectionOrder(page: Page) {
  return page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>("[data-section-id]")].map(
      (el) => el.dataset.sectionId!,
    ),
  );
}

test.describe("with motion, folding a section", () => {
  test.use({ contextOptions: { reducedMotion: "no-preference" } });

  test("slides the sections below it from where they were, not itself or those above", async ({
    page,
  }) => {
    await openBuilder(page);
    const [first, second, third] = await sectionOrder(page);
    const next = page.locator(`[data-section-id="${third}"]`);
    const topBefore = (await next.boundingBox())!.y;

    await headerRow(page, second).click();
    // Read in one step and polled at frame pace, since a slide lasts only a moment. Its first
    // frame draws the next section where it sat before the fold, so it travels the whole
    // distance rather than jumping most of it.
    let seen: { sliding: string[]; drawnAtStart: number } | null = null;
    await expect
      .poll(
        async () => {
          seen = await next.evaluate((el) => {
            const slide = el.getAnimations().find((a) => a.id === "row-slide");
            if (!slide) return null;
            const sliding = [
              ...document.querySelectorAll<HTMLElement>("[data-section-id]"),
            ]
              .filter((section) =>
                section.getAnimations().some((a) => a.id === "row-slide"),
              )
              .map((section) => section.dataset.sectionId!);
            slide.currentTime = 0;
            return { sliding, drawnAtStart: el.getBoundingClientRect().top };
          });
          return seen !== null;
        },
        { intervals: [16] },
      )
      .toBe(true);
    const { sliding, drawnAtStart } = seen!;
    expect(sliding).not.toContain(first);
    expect(sliding).not.toContain(second);
    expect(Math.abs(drawnAtStart - topBefore)).toBeLessThan(2);
  });

  test("collapses a rail through a view transition", async ({ page }) => {
    await openBuilder(page);
    const toggle = page
      .getByTestId("nav-column")
      .getByTestId("rail-toggle-left");
    await toggle.click();
    await expect
      .poll(() =>
        page.evaluate(() =>
          document
            .getAnimations()
            .some((a) =>
              (a.effect as KeyframeEffect | null)?.pseudoElement?.includes(
                "rail-nav",
              ),
            ),
        ),
      )
      .toBe(true);
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
  });

  // Only the rails are snapshotted: capturing the root, or the column beside a rail, costs
  // long frames on a heavy build.
  test("a rail morph captures the rails and nothing else", async ({ page }) => {
    await openBuilder(page);
    await page
      .getByTestId("nav-column")
      .getByTestId("rail-toggle-left")
      .click();
    await expect
      .poll(() => morphingGroups(page), { intervals: [16] })
      .toContain("rail-nav");
    const rails = ["rail-nav", "rail-details", "rail-entries"];
    const others = (await morphingGroups(page)).filter(
      (name) => !rails.includes(name),
    );
    expect(others).toEqual([]);
  });

  // The marker that keeps the root out of a rail morph has to go once the morph is over,
  // even when a second toggle cuts the first one short, or the theme cross-fade would lose
  // the page.
  test("the root is unmarked once a rail morph settles, even one cut short", async ({
    page,
  }) => {
    await openBuilder(page);
    const toggle = page
      .getByTestId("nav-column")
      .getByTestId("rail-toggle-left");
    await toggle.evaluate((button: HTMLElement) => {
      button.click();
      requestAnimationFrame(() => button.click());
    });
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await expect(page.locator("html")).not.toHaveAttribute(
      "data-rail-morph",
      /.*/,
    );

    const theme = page.getByRole("button", { name: /^Theme:/ });
    await theme.click();
    await theme.click();
    await expect
      .poll(() =>
        page.evaluate(() =>
          document
            .getAnimations()
            .some(
              (a) =>
                (a.effect as KeyframeEffect | null)?.pseudoElement ===
                "::view-transition-new(root)",
            ),
        ),
      )
      .toBe(true);
  });
});

test.describe("with reduced motion", () => {
  test("folding a section slides nothing", async ({ page }) => {
    await openBuilder(page);
    const [, second] = await sectionOrder(page);
    const before = await headerRow(page, second).getAttribute("aria-expanded");
    await headerRow(page, second).click();
    await expect(headerRow(page, second)).not.toHaveAttribute(
      "aria-expanded",
      before ?? "",
    );
    expect(await slidingSections(page)).toEqual([]);
  });

  test("entrances collapse to effectively nothing", async ({ page }) => {
    await openBuilder(page);

    await page.getByTestId("header-import-from-game").click();
    const found = await entrance(
      page.getByRole("dialog", { name: "Import from game" }),
    );
    expect(found?.ms ?? 0).toBeLessThan(1);
  });
});
