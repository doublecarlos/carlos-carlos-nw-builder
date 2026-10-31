// The stat panel on a phone's stats pane and in the tablet's fixed stats column: compared stats,
// the bonuses tab and the source card all fit, and a table too wide for the panel scrolls
// inside its own box instead of the page or the panel.
import { test, expect, type Page } from "@playwright/test";
import {
  openBuilder,
  chooseClass,
  chooseCombo,
  chooseItem,
} from "../support/app";
import { renameViaSidebar } from "../support/nav";
import { statCard, statInfoButton } from "../support/stats";
import { shippedItemName } from "../support/shippedData";
import {
  MIN_SUPPORTED_WIDTH,
  expectNoHorizontalScroll,
} from "../support/viewport";

const LONG_NAME = "Supercalifragilisticexpialidocious-Reference-Build";
const RING = shippedItemName("m33-frostsilver-coil-of-wrath");

const statColumn = (page: Page) => page.getByTestId("stat-panel-column");
const tableScrolls = (page: Page) =>
  statColumn(page).getByTestId("stat-table-scroll");

/** A build with bonuses, compared against a differing build with a long name and its stats
 *  stacked in. Set up at desktop width, where the nav is a plain column. */
async function openComparedBuild(page: Page) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openBuilder(page);
  await renameViaSidebar(
    page,
    page.locator(".nav-row--build").first(),
    LONG_NAME,
  );
  await page.getByTestId("nav-add-build").click();
  await chooseClass(page, "warlock");
  await chooseItem(page, "gear.ring1", RING);
  await chooseCombo(page.locator(".compare-select"), LONG_NAME);
  await page.getByRole("checkbox", { name: "Compare stats" }).check();
}

/** Shows the stats pane at `width`: the phone's switch, or the tablet's side column. */
async function showStats(page: Page, width: number) {
  await page.setViewportSize({ width, height: 800 });
  if (width < 768) await page.getByTestId("pane-stats").click();
  await expect(statColumn(page)).toContainText("Ratings");
}

/** Asserts no box inside the stats column scrolls sideways, other than a table's own. */
async function expectColumnFits(page: Page) {
  const overflowing = await statColumn(page).evaluate((column: HTMLElement) =>
    [column, ...column.querySelectorAll<HTMLElement>("*")]
      .filter((el) => el.dataset.testid !== "stat-table-scroll")
      .filter((el) => el.offsetParent && el.scrollWidth > el.clientWidth + 1)
      .filter((el) =>
        ["auto", "scroll"].includes(getComputedStyle(el).overflowX),
      )
      .map((el) => el.className),
  );
  expect(overflowing).toEqual([]);
}

for (const width of [MIN_SUPPORTED_WIDTH, 412, 900]) {
  test(`compared stats and bonuses fit at ${width}px`, async ({ page }) => {
    await openComparedBuild(page);
    await showStats(page, width);
    await expect(page.getByTestId("compare-line").first()).toBeVisible();

    await expectNoHorizontalScroll(page);
    await expectColumnFits(page);
    // The long compare name truncates in its cell instead of widening the table: every table
    // is as wide with the name's lines as without them. A table may still scroll in its own
    // box when its numbers need the room, which depends on the font.
    for (const scroll of await tableScrolls(page).all()) {
      const { nameLines, withName, withoutName } = await scroll.evaluate(
        (el, name) => {
          const withName = el.scrollWidth;
          const lines = [
            ...el.querySelectorAll<HTMLElement>('[data-testid="compare-line"]'),
          ].filter((line) => line.title === name);
          for (const line of lines) line.style.display = "none";
          const withoutName = el.scrollWidth;
          for (const line of lines) line.style.display = "";
          return { nameLines: lines.length, withName, withoutName };
        },
        LONG_NAME,
      );
      expect(nameLines).toBeGreaterThan(0);
      expect(withName).toBe(withoutName);
    }

    await page.getByRole("button", { name: /Bonuses/ }).click();
    await expect(page.getByTestId("bonus-filter")).toBeVisible();
    const titles = statColumn(page).locator("[data-bonus-id] > div > button");
    for (let i = 0; i < Math.min(await titles.count(), 8); i++)
      await titles.nth(i).click();
    await expectNoHorizontalScroll(page);
    await expectColumnFits(page);
  });
}

test("a table wider than the panel scrolls inside its own box", async ({
  page,
}) => {
  await openComparedBuild(page);
  await showStats(page, MIN_SUPPORTED_WIDTH);

  const ratings = tableScrolls(page).filter({ hasText: "Overcap" });
  await ratings.locator("table").evaluate((table) => {
    table.style.minWidth = "700px";
  });

  const box = await ratings.evaluate((el) => {
    el.scrollLeft = 200;
    return {
      scrollWidth: el.scrollWidth,
      clientWidth: el.clientWidth,
      scrollLeft: el.scrollLeft,
    };
  });
  expect(box.scrollWidth).toBeGreaterThan(box.clientWidth);
  expect(box.scrollLeft).toBeGreaterThan(0);
  await expectNoHorizontalScroll(page);
  await expectColumnFits(page);
});

test("an open bonus spells out its whole title on touch", async ({ page }) => {
  await openComparedBuild(page);
  await showStats(page, MIN_SUPPORTED_WIDTH);
  await page.getByRole("button", { name: /Bonuses/ }).click();

  const title = statColumn(page).getByTestId("bonus-entry-title").first();
  const whiteSpace = () =>
    title.evaluate((el) => getComputedStyle(el).whiteSpace);
  expect(await whiteSpace()).toBe("nowrap");

  await title.click();
  expect(await whiteSpace()).toBe("normal");
});

test("a stat's source card opens on tap and fits the screen", async ({
  page,
}) => {
  await openComparedBuild(page);
  await showStats(page, MIN_SUPPORTED_WIDTH);

  await statInfoButton(page, "power").click();
  const box = (await statCard(page).boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(MIN_SUPPORTED_WIDTH);
  await expectNoHorizontalScroll(page);
});
