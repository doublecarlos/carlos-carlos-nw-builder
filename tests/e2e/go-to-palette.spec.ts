// The "go to" palette: Mod+K over every place worth jumping to. Ranking itself is covered by
// tests/unit/go-to.spec.ts; this is about opening it, what choosing a row actually does, and
// the header affordance that tells anyone it exists.
import { test, expect, type Page } from "@playwright/test";
import { openBuilder, headerRow, cursorRow, slotRow } from "./support/app";
import {
  addBuild,
  addFolder,
  buildRow,
  folderRow,
  openRowMenu,
  renameViaSidebar,
} from "./support/nav";

const palette = (page: Page) => page.getByTestId("go-to-palette");
const input = (page: Page) => page.getByTestId("go-to-input");
const option = (page: Page, key: string) =>
  page.getByTestId(`go-to-option-${key}`);

async function openPalette(page: Page, query?: string) {
  await page.keyboard.press("ControlOrMeta+k");
  await expect(input(page)).toBeFocused();
  if (query) await input(page).fill(query);
}

test.describe("opening and dismissing", () => {
  test("Mod+K opens it with the cursor already in the box", async ({
    page,
  }) => {
    await openBuilder(page);

    await openPalette(page);

    await expect(palette(page)).toBeVisible();
  });

  test("Mod+K reaches it even from inside a text field", async ({ page }) => {
    await openBuilder(page);
    await page.getByTestId("slot-filter-text").click();
    await expect(page.getByTestId("slot-filter-text")).toBeFocused();

    await page.keyboard.press("ControlOrMeta+k");

    // The one shortcut here that survives a focused field -- it carries its own modifier, so
    // it types nothing, and a palette you cannot reach mid-typing is one you have to think about.
    await expect(input(page)).toBeFocused();
  });

  test("the header carries a visible way in, naming its own shortcut", async ({
    page,
  }) => {
    await openBuilder(page);
    const trigger = page.getByTestId("header-go-to");

    // A palette nobody knows the binding for is a palette nobody uses.
    await expect(trigger).toContainText("Go to");
    await expect(trigger.locator("kbd")).toContainText("K");

    await trigger.click();

    await expect(palette(page)).toBeVisible();
  });

  test("Escape closes it and hands focus back", async ({ page }) => {
    await openBuilder(page);
    const trigger = page.getByTestId("header-go-to");
    await trigger.click();

    await page.keyboard.press("Escape");

    await expect(palette(page)).toBeHidden();
    await expect(trigger).toBeFocused();
  });

  test("a query with no destinations says so rather than showing an empty box", async ({
    page,
  }) => {
    await openBuilder(page);

    await openPalette(page, "zzzzz nothing");

    await expect(palette(page)).toContainText("Nothing matches");
  });
});

test.describe("choosing a destination", () => {
  test("a slot lands the keyboard cursor on its row, ready for Enter", async ({
    page,
  }) => {
    await openBuilder(page);

    await openPalette(page, "offhand mod 1");
    await page.keyboard.press("Enter");

    // Not merely scrolled into view: parked, so the existing row keys take over from here.
    await expect(cursorRow(page)).toHaveAttribute(
      "data-cursor-key",
      "slot:gear.offhandMod1",
    );
    await expect(palette(page)).toBeHidden();
  });

  test("a slot row comes to rest below its own sticky header, not under it", async ({
    page,
  }) => {
    await openBuilder(page);

    await openPalette(page, "offhand mod 1");
    await page.keyboard.press("Enter");
    await expect(palette(page)).toBeHidden();

    await expect
      .poll(async () =>
        page.evaluate(() => {
          const row = document
            .querySelector('[data-cursor-key="slot:gear.offhandMod1"]')!
            .getBoundingClientRect();
          const header = document
            .querySelector(
              '[data-section-id="gear"] [data-cursor-key^="header:"]',
            )!
            .getBoundingClientRect();
          return Math.round(row.top - header.bottom);
        }),
      )
      .toBeGreaterThanOrEqual(0);
  });

  test("a slot inside a collapsed section opens it on the way", async ({
    page,
  }) => {
    await openBuilder(page);
    await headerRow(page, "gear").click();
    await expect(headerRow(page, "gear")).toContainText("▸");

    await openPalette(page, "offhand mod 1");
    await page.keyboard.press("Enter");

    // The one place navigating rewrites the layout, and deliberately: unlike Mod+arrow,
    // which lands on a header that exists either way, a row in a closed section has nothing
    // to land on at all.
    await expect(headerRow(page, "gear")).toContainText("▾");
    await expect(slotRow(page, "gear.offhandMod1")).toBeVisible();
  });

  test("a section lands the cursor on its header, without opening it", async ({
    page,
  }) => {
    await openBuilder(page);
    await headerRow(page, "boons").click();
    await expect(headerRow(page, "boons")).toContainText("▸");

    await openPalette(page, "boons");
    await page.keyboard.press("Enter");

    // The palette dismisses itself, so it has to hand focus somewhere -- scrolling alone would
    // drop the user on <body>. The header is a cursor row in its own right.
    await expect(cursorRow(page)).toHaveAttribute(
      "data-cursor-key",
      "header:boons",
    );
    await expect(headerRow(page, "boons")).toBeInViewport();
    // And it exists either way, so unlike a slot jump this leaves the section closed.
    await expect(headerRow(page, "boons")).toContainText("▸");
  });

  test("the last section is reachable, though it cannot scroll to the top", async ({
    page,
  }) => {
    await openBuilder(page);

    await openPalette(page, "misc");
    await page.keyboard.press("Enter");

    // Misc is the bottom of the list, so scrolling runs out before its header reaches the top.
    // Parking the cursor is what makes it land anyway -- there is no scroll position that
    // would.
    await expect(cursorRow(page)).toHaveAttribute(
      "data-cursor-key",
      "header:misc",
    );
    await expect(headerRow(page, "misc")).toBeInViewport();
  });

  test("the cursor a section jump parks carries straight on into the row keys", async ({
    page,
  }) => {
    await openBuilder(page);

    await openPalette(page, "boons");
    await page.keyboard.press("Enter");
    await expect(cursorRow(page)).toHaveAttribute(
      "data-cursor-key",
      "header:boons",
    );

    // Landing on a real cursor row is the point: everything the header row already does works
    // from here without touching the mouse.
    await page.keyboard.press("ArrowDown");
    await expect(cursorRow(page)).toHaveAttribute(
      "data-cursor-key",
      "slot:boons.guildOffense",
    );
  });

  test("arrow keys move the highlight before Enter takes it", async ({
    page,
  }) => {
    await openBuilder(page);

    await openPalette(page, "offhand mod");
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");

    await expect(cursorRow(page)).toHaveAttribute(
      "data-cursor-key",
      "slot:gear.offhandMod2",
    );
  });

  test("clicking a row works the same as choosing it with Enter", async ({
    page,
  }) => {
    await openBuilder(page);

    await openPalette(page, "boots");
    await option(page, "slot:gear.boots").click();

    await expect(cursorRow(page)).toHaveAttribute(
      "data-cursor-key",
      "slot:gear.boots",
    );
  });

  test("a build switches to it", async ({ page }) => {
    await openBuilder(page);
    await addBuild(page);
    await expect(buildRow(page, "Build 2")).toHaveClass(/is-active/);

    await openPalette(page, "Build 1");
    await page.keyboard.press("Enter");

    await expect(buildRow(page, "Build 1")).toHaveClass(/is-active/);
    await expect(palette(page)).toBeHidden();
  });

  test("a build row names the folder holding it", async ({ page }) => {
    await openBuilder(page);
    await addBuild(page);
    await addFolder(page);
    await renameViaSidebar(page, folderRow(page, "Folder 1"), "Alts");
    const menu = await openRowMenu(buildRow(page, "Build 1"));
    await menu.getByRole("button", { name: "Move to “Alts”" }).click();

    await openPalette(page, "Build");

    // Same disambiguation the build pickers show: two builds can share a name across folders.
    const rows = page.getByTestId(/^go-to-option-build:/);
    await expect(rows.filter({ hasText: "Build 1" })).toContainText("Alts");
    await expect(rows.filter({ hasText: "Build 2" })).not.toContainText("Alts");
  });

  test("a slot chosen while a layer is open brings the build editor back with it", async ({
    page,
  }) => {
    await openBuilder(page);
    await page.getByTestId("nav-add-layer").click();
    await expect(page.getByTestId("builder-content")).toBeHidden();

    await openPalette(page, "offhand mod 1");
    await page.keyboard.press("Enter");

    // The request waits in the store until BuildEditor mounts and consumes it.
    await expect(cursorRow(page)).toHaveAttribute(
      "data-cursor-key",
      "slot:gear.offhandMod1",
    );
  });
});
