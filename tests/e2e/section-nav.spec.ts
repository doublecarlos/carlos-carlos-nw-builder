// Getting between build sections without scrolling for it: headers that stay put
// while you read a long section, and Mod+arrow stepping a whole section per press. Reaching a
// section by name is the "go to" palette's job -- tests/e2e/go-to-palette.spec.ts.
import { test, expect, type Page } from "@playwright/test";
import {
  openBuilder,
  headerRow,
  cursorRow,
  parkCursorOnRow,
} from "./support/app";

/** Scrolls the list so a section's top is at the top of it, the way a jump leaves it. */
async function scrollSectionToTop(page: Page, sectionId: string) {
  await page.evaluate((id) => {
    const scroller = document.querySelector('[data-testid="editor-column"]')!;
    const section = document.querySelector(`[data-section-id="${id}"]`)!;
    scroller.scrollTop +=
      section.getBoundingClientRect().top -
      scroller.getBoundingClientRect().top;
  }, sectionId);
}

/** How far a section's own header sits from the top of the scrolling list. */
function headerInset(page: Page, sectionId: string) {
  return page.evaluate((id) => {
    const scroller = document.querySelector('[data-testid="editor-column"]')!;
    const header = document.querySelector(
      `[data-section-id="${id}"] [data-cursor-key^="header:"]`,
    )!;
    return Math.round(
      header.getBoundingClientRect().top - scroller.getBoundingClientRect().top,
    );
  }, sectionId);
}

test.describe("sticky section headers", () => {
  test("a section's header stays put while its own rows scroll past", async ({
    page,
  }) => {
    await openBuilder(page);
    await scrollSectionToTop(page, "boons");

    // Far enough into Boons that its header's natural position is well off the top.
    await page
      .getByTestId("editor-column")
      .evaluate((el) => el.scrollBy(0, 400));

    // Which section you are reading is what a long section otherwise stops telling you.
    await expect(headerRow(page, "boons")).toBeInViewport();
    await expect.poll(() => headerInset(page, "boons")).toBe(0);
  });

  test("a header gives way to the next section's rather than stacking up", async ({
    page,
  }) => {
    await openBuilder(page);
    await scrollSectionToTop(page, "boons");

    // Past the end of Boons entirely.
    await page
      .getByTestId("editor-column")
      .evaluate((el) => el.scrollBy(0, 4000));

    // Each header sticks within its own section, so the outgoing one is pushed off rather than
    // piling up with the one arriving under it.
    await expect.poll(() => headerInset(page, "boons")).toBeLessThan(0);
  });

  test("nothing scrolls through the band above a pinned header", async ({
    page,
  }) => {
    await openBuilder(page);

    // A scroll container does not clip inside its own padding, so the list's padding lives on
    // the content instead -- otherwise rows would show above the header, unclipped.
    const scrollerPadTop = await page
      .getByTestId("editor-column")
      .evaluate((el) => getComputedStyle(el).paddingTop);
    expect(scrollerPadTop).toBe("0px");
  });
});

test.describe("Mod+arrow section cursor", () => {
  test("steps to the next section's first slot", async ({ page }) => {
    await openBuilder(page);
    await parkCursorOnRow(page, "options.class");

    await page.keyboard.press("ControlOrMeta+ArrowDown");

    await expect(cursorRow(page)).toHaveAttribute(
      "data-cursor-key",
      "slot:raceLeveling.race",
    );
  });

  test("steps back to the previous section from the middle of one", async ({
    page,
  }) => {
    await openBuilder(page);
    await parkCursorOnRow(page, "gear.boots");

    await page.keyboard.press("ControlOrMeta+ArrowUp");

    await expect(cursorRow(page)).toHaveAttribute(
      "data-cursor-key",
      "slot:raceLeveling.race",
    );
  });

  test("lands on the header of a collapsed section, which Enter then expands", async ({
    page,
  }) => {
    await openBuilder(page);
    await headerRow(page, "raceLeveling").click();
    await expect(headerRow(page, "raceLeveling")).toContainText("▸");
    await parkCursorOnRow(page, "options.class");

    await page.keyboard.press("ControlOrMeta+ArrowDown");

    // No slots to land on, so the header is the stop -- and it says what to do next.
    await expect(cursorRow(page)).toHaveAttribute(
      "data-cursor-key",
      "header:raceLeveling",
    );
    await page.keyboard.press("Enter");
    await expect(headerRow(page, "raceLeveling")).toContainText("▾");
  });

  test("stops at the last section rather than losing the cursor", async ({
    page,
  }) => {
    await openBuilder(page);
    await parkCursorOnRow(page, "options.class");

    const sectionCount = await page.locator("[data-section-id]").count();
    for (let i = 0; i < sectionCount + 2; i += 1)
      await page.keyboard.press("ControlOrMeta+ArrowDown");

    // Misc is an item_picker_list, so the last section's only row is its add button.
    await expect(cursorRow(page)).toHaveAttribute(
      "data-cursor-key",
      "slot:misc.misc",
    );
  });

  test("plain arrows still move one row at a time", async ({ page }) => {
    await openBuilder(page);
    await parkCursorOnRow(page, "options.class");

    await page.keyboard.press("ArrowDown");

    await expect(cursorRow(page)).toHaveAttribute(
      "data-cursor-key",
      "slot:options.paragon",
    );
  });
});
