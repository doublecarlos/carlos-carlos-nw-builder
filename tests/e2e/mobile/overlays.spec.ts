// Overlays and touch on a phone: modals fill the screen, a drag starts only from a grip so a
// swipe on a row scrolls, a tap never pops a tooltip, and keyboard hints stay out of sight.
import { test, expect, type Locator, type Page } from "@playwright/test";
import { chooseItem, ensureSectionExpanded, openBuilder } from "../support/app";
import { addBuild, addLayer, buildRow, layerRow } from "../support/nav";
import { requireBox } from "../support/dragDrop";
import {
  MIN_SUPPORTED_WIDTH,
  expectNoHorizontalScroll,
} from "../support/viewport";

const hamburger = (page: Page) => page.getByTestId("header-nav-toggle");
const drawer = (page: Page) => page.getByTestId("nav-drawer");
const buildRows = (page: Page) => page.locator(".nav-row--build");

async function openDrawer(page: Page) {
  if (!(await drawer(page).isVisible())) await hamburger(page).click();
  await expect(drawer(page)).toBeVisible();
}

/** Adds builds until there are `count`; each one selected closes the drawer behind it. */
async function seedBuilds(page: Page, count: number) {
  for (let n = 2; n <= count; n++) {
    await openDrawer(page);
    await addBuild(page);
  }
  await openDrawer(page);
  await expect(buildRows(page)).toHaveCount(count);
}

/** Asserts the dialog inside `modal` covers the viewport exactly and nothing scrolls sideways. */
async function expectFillsViewport(page: Page, modal: Locator) {
  const panel = modal.getByRole("dialog");
  const box = (await panel.boundingBox())!;
  const { width, height } = page.viewportSize()!;
  expect(box.x).toBe(0);
  expect(box.y).toBe(0);
  expect(box.width).toBe(width);
  expect(box.height).toBe(height);
  const { scrollWidth, clientWidth } = await panel.evaluate((el) => ({
    scrollWidth: el.scrollWidth,
    clientWidth: el.clientWidth,
  }));
  expect(scrollWidth).toBeLessThanOrEqual(clientWidth);
  await expectNoHorizontalScroll(page);
}

/** Real touch input through CDP, so the browser sees a finger: pointer events arrive with
 *  `pointerType: "touch"` and an unclaimed move scrolls the page as a swipe would. */
async function touchDrag(
  page: Page,
  from: { x: number; y: number },
  to: { x: number; y: number },
  steps = 12,
) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [from],
  });
  for (let i = 1; i <= steps; i++) {
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [
        {
          x: from.x + ((to.x - from.x) * i) / steps,
          y: from.y + ((to.y - from.y) * i) / steps,
        },
      ],
    });
  }
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  });
  await cdp.detach();
}

async function center(target: Locator) {
  const box = await requireBox(target);
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

test.describe("modals at the narrowest width", () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: MIN_SUPPORTED_WIDTH, height: 740 });
  });

  test("the stable browser fills the screen", async ({ page }) => {
    await openBuilder(page);
    await ensureSectionExpanded(page, "insignia");
    await page.getByTestId("open-stable-browser:insignia.mount1").click();
    const modal = page.getByTestId("stable-browser");
    await expect(modal).toBeVisible();
    await expectFillsViewport(page, modal);
    await page.getByTestId("stable-tab-bonus").click();
    await expectFillsViewport(page, modal);
  });

  test("the layer export and tooltip import fill the screen", async ({
    page,
  }) => {
    await openBuilder(page);
    await openDrawer(page);
    await addLayer(page);
    await openDrawer(page);
    await layerRow(page, "Layer 1").locator(".nav-name").click();

    await page.getByTestId("layer-export-toggle").click();
    const exportModal = page.getByTestId("layer-export");
    await expect(exportModal).toBeVisible();
    await expectFillsViewport(page, exportModal);
    await exportModal.getByTestId("modal-close").click();
    await expect(exportModal).toHaveCount(0);

    // Clicked from script: the layer editor's toolbar is not laid out for a phone yet, and
    // this button sits past the screen's edge.
    await page
      .getByTestId("tooltip-import-toggle")
      .evaluate((el: HTMLElement) => el.click());
    const importModal = page.getByTestId("tooltip-import");
    await expect(importModal).toBeVisible();
    await expectFillsViewport(page, importModal);
  });

  test("a confirmation stays a card inside the screen, without the Shift hint", async ({
    page,
  }) => {
    await openBuilder(page);
    await seedBuilds(page, 2);
    await buildRow(page, "Build 1").locator(".nav-kebab").click();
    await page
      .locator(".navmenu")
      .getByRole("button", { name: "Delete…" })
      .click();

    const dialog = page.getByTestId("confirm-dialog").getByRole("dialog");
    await expect(dialog).toBeVisible();
    const box = (await dialog.boundingBox())!;
    expect(box.x).toBeGreaterThan(0);
    expect(box.x + box.width).toBeLessThan(MIN_SUPPORTED_WIDTH);
    await expectNoHorizontalScroll(page);
    await expect(dialog.getByText("Hold Shift")).toBeHidden();
  });
});

test("a build reorders by dragging its grip with a finger", async ({
  page,
}) => {
  await openBuilder(page);
  await seedBuilds(page, 3);

  const grip = buildRow(page, "Build 1").getByTestId("nav-drag-handle");
  await touchDrag(
    page,
    await center(grip),
    await center(buildRow(page, "Build 3")).then((p) => ({
      ...p,
      y: p.y + 12,
    })),
  );

  await expect(buildRows(page).nth(0)).toContainText("Build 2");
  await expect(buildRows(page).nth(1)).toContainText("Build 3");
  await expect(buildRows(page).nth(2)).toContainText("Build 1");
});

test("a swipe on a row's body scrolls the list instead of dragging", async ({
  page,
}) => {
  await page.setViewportSize({ width: MIN_SUPPORTED_WIDTH, height: 560 });
  await openBuilder(page);
  await seedBuilds(page, 14);

  // The build list scrolls inside its own box: the list or the first scroller around it.
  const scrollTop = () =>
    page.getByTestId("nav-builds-list").evaluate((list) => {
      let el: HTMLElement | null = list as HTMLElement;
      while (el && getComputedStyle(el).overflowY !== "auto")
        el = el.parentElement;
      return el?.scrollTop ?? 0;
    });
  const before = await scrollTop();
  // A drag that starts and is then canceled would leave the order alone too, so watch for one.
  await page.evaluate(() => {
    const html = document.documentElement;
    new MutationObserver(() => {
      if (html.classList.contains("is-dragging")) html.dataset.draggedOnce = "";
    }).observe(html, { attributes: true, attributeFilter: ["class"] });
  });

  const name = buildRow(page, "Build 6").locator(".nav-name");
  const start = await center(name);
  await touchDrag(page, start, { x: start.x, y: start.y - 200 });

  await expect.poll(scrollTop).toBeGreaterThan(before);
  await expect(page.locator("html")).not.toHaveAttribute("data-dragged-once");
  for (let n = 1; n <= 14; n++) {
    await expect(buildRows(page).nth(n - 1)).toContainText(`Build ${n}`);
  }
});

test("a tap on a button with a tooltip shows no tooltip", async ({ page }) => {
  await openBuilder(page);
  await page.getByTestId("pane-stats").tap();
  await page.locator("button.stat-info-btn").first().tap();
  await expect(page.getByTestId("stat-card")).toBeVisible();
  await expect(page.getByTestId("tooltip")).toHaveCount(0);
});

test("focus handed back after a tap shows no tooltip", async ({ page }) => {
  await openBuilder(page);
  await chooseItem(page, "gear.head", "M29 Enchanted Depthweave Cap");
  const info = page.getByTestId("slot-info:gear.head");
  await info.tap();
  const sheet = page.getByTestId("item-card-sheet");
  await expect(sheet).toBeVisible();
  await sheet.getByTestId("sheet-close").tap();

  await expect(sheet).toHaveCount(0);
  await expect(info).toBeFocused();
  await expect(page.getByTestId("tooltip")).toHaveCount(0);
});

test("a tap on an info-only label shows its text", async ({ page }) => {
  await openBuilder(page);
  await page.getByTestId("autosave-indicator").tap();
  await expect(page.getByTestId("tooltip")).toContainText(
    "saved automatically",
  );
  await page.getByTestId("app-header").tap({ position: { x: 5, y: 5 } });
  await expect(page.getByTestId("tooltip")).toHaveCount(0);
});

test("keyboard hints are left out on touch", async ({ page }) => {
  await openBuilder(page);
  await expect(page.locator("kbd:visible")).toHaveCount(0);
  await expect(page.getByTestId("slot-filter-text")).toHaveAttribute(
    "placeholder",
    "Filter slots…",
  );

  await openDrawer(page);
  await buildRow(page, "Build 1").locator(".nav-kebab").click();
  const menu = page.locator(".navmenu");
  await expect(menu.getByRole("button", { name: "Rename" })).toHaveText(
    "Rename",
  );
});
