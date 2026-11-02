// A reordered row slides to its new place, on a move and on its undo, so it is clear where it
// went: the moved row is marked and kept in view, clear of a form's sticky bar. Filtering the
// list rearranges nothing and slides nothing, and reduced motion turns the slide off but still
// keeps the row in view.
import { test, expect, type Page } from "@playwright/test";
import { openBuilder } from "./support/app";
import {
  addBuild,
  addLayer,
  buildRow,
  filterBuilds,
  layerRow,
  moveDown,
} from "./support/nav";

/** The rows sliding right now, by their flip key. */
function sliding(page: Page) {
  return page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>("[data-flip-key]")]
      .filter((row) => row.getAnimations().some((a) => a.id === "row-slide"))
      .map((row) => row.dataset.flipKey),
  );
}

/** The rows marked as the one moved, by their flip key. */
function flashing(page: Page) {
  return page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>("[data-flip-key]")]
      .filter((row) =>
        row.getAnimations().some((a) => a.id === "reorder-flash"),
      )
      .map((row) => row.dataset.flipKey),
  );
}

/** The flip keys of the top-level build rows, in list order. */
function buildOrder(page: Page) {
  return page
    .getByTestId("nav-builds-list")
    .locator(":scope > .nav-row")
    .evaluateAll((rows) =>
      rows.map((row) => (row as HTMLElement).dataset.flipKey),
    );
}

async function twoBuilds(page: Page) {
  await openBuilder(page);
  await addBuild(page);
  await expect(buildRow(page, "Build 2")).toBeVisible();
}

test.describe("with motion", () => {
  test.use({ contextOptions: { reducedMotion: "no-preference" } });

  test("moving a build slides both rows, and so does undoing it", async ({
    page,
  }) => {
    await twoBuilds(page);
    const [first, second] = await buildOrder(page);

    await moveDown(buildRow(page, "Build 1"));
    // Polled at frame pace: a slide lasts only a moment.
    await expect
      .poll(async () => (await sliding(page)).sort(), { intervals: [16] })
      .toEqual([first, second].sort());
    expect(await buildOrder(page)).toEqual([second, first]);
    // The row moved is marked, not the one it displaced.
    expect(await flashing(page)).toEqual([first]);

    await expect.poll(() => flashing(page)).toEqual([]);
    await page.getByTestId("nav-undo").click();
    await expect
      .poll(async () => (await sliding(page)).sort(), { intervals: [16] })
      .toEqual([first, second].sort());
    expect(await buildOrder(page)).toEqual([first, second]);
  });

  test("filtering the list slides nothing", async ({ page }) => {
    await twoBuilds(page);
    await filterBuilds(page, "Build 2");
    await expect(buildRow(page, "Build 1")).toBeHidden();
    expect(await sliding(page)).toEqual([]);
  });
});

/** Six layers, more than the layer list shows at once, with the first one moved to the end a
 *  step at a time from the keyboard, refocused without scrolling so only the app scrolls.
 *  Returns the moved row, once every slide has ended. */
async function layerToBottom(page: Page) {
  await openBuilder(page);
  for (let i = 0; i < 6; i++) await addLayer(page);
  await expect(layerRow(page, "Layer 6")).toBeVisible();
  const row = layerRow(page, "Layer 1");
  await row.scrollIntoViewIfNeeded();
  for (let i = 0; i < 5; i++) {
    await row
      .locator(".nav-name")
      .evaluate((el) => (el as HTMLElement).focus({ preventScroll: true }));
    await page.keyboard.press("Control+ArrowDown");
  }
  await expect.poll(() => sliding(page)).toEqual([]);
  return row;
}

test.describe("with motion, a long list", () => {
  test.use({ contextOptions: { reducedMotion: "no-preference" } });

  test("keeps the moved row in view", async ({ page }) => {
    const row = await layerToBottom(page);
    await expect(row).toBeInViewport({ ratio: 1 });
  });
});

test("reduced motion moves a row without sliding it", async ({ page }) => {
  await twoBuilds(page);
  const [first, second] = await buildOrder(page);
  await moveDown(buildRow(page, "Build 1"));
  await expect.poll(() => buildOrder(page)).toEqual([second, first]);
  expect(await sliding(page)).toEqual([]);
});

/** A new bonus with six named grants, scrolled to the last one, which then moves up four
 *  places from the keyboard. Keys rather than clicks, so nothing but the app scrolls. Returns
 *  the moved grant and its key. */
async function grantUpFromBottom(page: Page) {
  await openBuilder(page);
  await addLayer(page);
  await layerRow(page, "Layer 1").locator(".nav-name").click();
  await page.getByRole("button", { name: /Bonuses \d+/ }).click();
  await page.getByTestId("new-bonus").click();
  const addGrant = page.getByLabel("Add grant");
  for (let i = 0; i < 6; i++) await addGrant.click();
  for (let i = 0; i < 6; i++)
    await page.getByTestId("add-grant-name-description").first().click();

  const grants = page.getByTestId("bonus-grant-row");
  const key = await grants.last().getAttribute("data-flip-key");
  const grant = page.locator(`[data-flip-key="${key}"]`);
  const moveUp = grant.getByLabel("Move grant up").first();
  await moveUp.scrollIntoViewIfNeeded();
  for (let i = 0; i < 4; i++) {
    // A reorder can detach the focused button; refocusing must not scroll it into view.
    await moveUp.evaluate((el) =>
      (el as HTMLElement).focus({ preventScroll: true }),
    );
    await page.keyboard.press("Enter");
    await expect(grants.nth(4 - i)).toHaveAttribute("data-flip-key", key!);
  }
  // Mid-slide a row is drawn where it was, so position checks wait for the slides to end.
  await expect.poll(() => sliding(page)).toEqual([]);
  return { grant, key: key! };
}

/** Whether the grant's top edge shows below the form's sticky bar, inside its pane. */
async function headerShows(page: Page, grant: ReturnType<Page["locator"]>) {
  const bar = (await page.getByTestId("form-bar").first().boundingBox())!;
  const pane = (await page.getByTestId("layer-form-pane").boundingBox())!;
  const box = (await grant.boundingBox())!;
  return box.y >= bar.y + bar.height - 1 && box.y < pane.y + pane.height;
}

test.describe("with motion, a form", () => {
  test.use({ contextOptions: { reducedMotion: "no-preference" } });

  test("marks the grant moved and keeps it clear of the sticky bar", async ({
    page,
  }) => {
    const { grant, key } = await grantUpFromBottom(page);
    // The ring outlasts the slide, so it is still on.
    expect(await flashing(page)).toEqual([key]);
    await expect.poll(() => headerShows(page, grant)).toBe(true);
  });
});

test("reduced motion keeps a moved grant clear of the sticky bar", async ({
  page,
}) => {
  const { grant } = await grantUpFromBottom(page);
  expect(await headerShows(page, grant)).toBe(true);
});

test.describe("with motion, tiers", () => {
  test.use({ contextOptions: { reducedMotion: "no-preference" } });

  // Tiers carry their own identity, so a moved tier is a row that travels, not one redrawn in
  // place with its neighbour's contents.
  test("a tier moved down slides and is marked", async ({ page }) => {
    await openBuilder(page);
    await addLayer(page);
    await layerRow(page, "Layer 1").locator(".nav-name").click();
    await page.getByRole("button", { name: /Bonuses \d+/ }).click();
    await page.getByTestId("new-bonus").click();
    await page.getByLabel("Add grant").click();
    const grant = page.getByTestId("bonus-grant-row").first();
    await grant.getByRole("button", { name: "tiered" }).click();
    await grant.getByTestId("add-tier").click();

    const tiers = grant.getByTestId("bonus-tier-row");
    const [first, second] = await tiers.evaluateAll((rows) =>
      rows.map((row) => (row as HTMLElement).dataset.flipKey),
    );
    await tiers.nth(0).getByLabel("Move tier down").click();
    await expect(tiers.nth(0)).toHaveAttribute("data-flip-key", second!);
    expect((await sliding(page)).sort()).toEqual([first, second].sort());
    expect(await flashing(page)).toEqual([first]);
  });
});
