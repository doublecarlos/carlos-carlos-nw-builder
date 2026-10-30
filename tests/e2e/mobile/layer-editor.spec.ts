// The layer editor on a phone: master-detail, where the entry list fills the pane and an open
// entry's form replaces it until Back. The toolbar's actions fold into a menu, and nothing
// scrolls sideways on the list or on any form.
import { test, expect, type Page } from "@playwright/test";
import { openBuilder } from "../support/app";
import { addLayer, confirmDialog, layerRow } from "../support/nav";
import {
  MIN_SUPPORTED_WIDTH,
  expectNoHorizontalScroll,
} from "../support/viewport";

const list = (page: Page) => page.getByTestId("layer-entries-column");
const form = (page: Page) => page.getByTestId("layer-form-pane");
const back = (page: Page) => page.getByTestId("layer-form-back");
const rows = (page: Page) => page.locator(".editor-row");

async function openDrawer(page: Page) {
  const drawer = page.getByTestId("nav-drawer");
  if (!(await drawer.isVisible()))
    await page.getByTestId("header-nav-toggle").click();
  await expect(drawer).toBeVisible();
}

async function openLayer(page: Page) {
  await openBuilder(page);
  await openDrawer(page);
  await addLayer(page);
  await openDrawer(page);
  await layerRow(page, "Layer 1").locator(".nav-name").click();
  await expect(list(page)).toBeVisible();
}

async function expectListView(page: Page) {
  await expect(list(page)).toBeVisible();
  await expect(form(page)).toHaveCount(0);
  await expect(back(page)).toHaveCount(0);
}

async function expectFormView(page: Page) {
  await expect(form(page)).toBeVisible();
  await expect(back(page)).toBeVisible();
  await expect(list(page)).toHaveCount(0);
}

/** No sideways scroll on the page, nor inside the form's own scroller. */
async function expectFits(page: Page) {
  await expectNoHorizontalScroll(page);
  if (await form(page).count()) {
    const { scrollWidth, clientWidth } = await form(page).evaluate((el) => ({
      scrollWidth: el.scrollWidth,
      clientWidth: el.clientWidth,
    }));
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth);
  }
}

test("an item opens full-width and Back returns to the list", async ({
  page,
}) => {
  await openLayer(page);
  // The list fills the pane, so it scrolls inside and leaves no rail toggle behind.
  await expect(page.getByTestId("rail-toggle-left")).toHaveCount(0);
  const name = (await rows(page)
    .nth(3)
    .locator(".editor-row-name")
    .textContent())!;

  await rows(page).nth(3).tap();
  await expectFormView(page);
  await expect(page.getByTestId("form-bar-title").first()).toHaveText(name);
  const pane = (await form(page).boundingBox())!;
  const listWidth = page.viewportSize()!.width;
  expect(pane.width).toBeGreaterThan(listWidth * 0.85);

  await back(page).tap();
  await expectListView(page);
  // The row stays marked, and tapping it again reopens the form.
  await rows(page).nth(3).tap();
  await expectFormView(page);
  await expect(page.getByTestId("form-bar-title").first()).toHaveText(name);
});

test("the list's route names no entry, so a reload lands on the list", async ({
  page,
}) => {
  await openLayer(page);
  const name = (await rows(page)
    .nth(3)
    .locator(".editor-row-name")
    .textContent())!;
  await rows(page).nth(3).tap();
  await expectFormView(page);
  await expect
    .poll(() => new URL(page.url()).searchParams.get("item"))
    .not.toBeNull();

  await back(page).tap();
  await expectListView(page);
  await expect
    .poll(() => new URL(page.url()).searchParams.get("item"))
    .toBeNull();
  await page.reload();
  await expectListView(page);

  // Reopening the marked row names it again, and a reload keeps its form.
  await rows(page).nth(3).tap();
  await expectFormView(page);
  await expect
    .poll(() => new URL(page.url()).searchParams.get("item"))
    .not.toBeNull();
  await page.reload();
  await expectFormView(page);
  await expect(page.getByTestId("form-bar-title").first()).toHaveText(name);

  // A tab switch lands on a list too, with no entry in the route.
  await page.getByTestId("tab-bonuses").tap();
  await expectListView(page);
  await page.reload();
  await expectListView(page);
});

test("a slot opens full-width and Back returns to the outline", async ({
  page,
}) => {
  await openLayer(page);
  await page.getByTestId("tab-slots").tap();
  const slot = page.locator('[data-outline-key^="slot:"]').first();
  const name = (await slot.locator(".editor-row-name").textContent())!;
  await slot.tap();
  await expectFormView(page);
  await expect(page.getByTestId("form-bar-title").first()).toHaveText(name);

  await back(page).tap();
  await expectListView(page);
  await expect(page.getByTestId("slot-outline")).toBeVisible();
});

test("a new entry opens its blank form", async ({ page }) => {
  await openLayer(page);
  await page.getByTestId("new-item").tap();
  await expectFormView(page);
  await expect(page.getByTestId("form-bar-title").first()).toHaveText(
    "New item",
  );

  // Switching tabs from a form lands on that tab's list.
  await page.getByTestId("tab-bonuses").tap();
  await expectListView(page);
  await page.getByTestId("new-bonus").tap();
  await expectFormView(page);
  await expect(page.getByTestId("form-bar-title").first()).toHaveText(
    "New bonus",
  );
});

test("a dirty draft vetoes Back until its discard is confirmed", async ({
  page,
}) => {
  await openLayer(page);
  await page.getByTestId("new-item").tap();
  await page.getByTestId("item-name-input").fill("ZZZ Phone Draft");

  await back(page).tap();
  await expect(confirmDialog(page)).toBeVisible();
  await page.getByTestId("confirm-cancel").tap();
  await expectFormView(page);
  await expect(page.getByTestId("item-name-input")).toHaveValue(
    "ZZZ Phone Draft",
  );

  await back(page).tap();
  await page.getByTestId("confirm-accept").tap();
  await expectListView(page);

  // The draft is gone: a new item starts blank.
  await page.getByTestId("new-item").tap();
  await expect(page.getByTestId("item-name-input")).toHaveValue("");
});

test("the view survives a trip to a build and back", async ({ page }) => {
  await openLayer(page);
  await rows(page).first().tap();
  await expectFormView(page);

  await openDrawer(page);
  await page.locator(".nav-row--build").first().locator(".nav-name").click();
  await expect(page.getByTestId("editor-pane")).toBeVisible();
  await openDrawer(page);
  await layerRow(page, "Layer 1").locator(".nav-name").click();
  await expectFormView(page);
});

test("the toolbar's actions sit in an overflow menu", async ({ page }) => {
  await openLayer(page);
  await expect(page.getByTestId("layer-export-toggle")).toHaveCount(0);
  await expect(page.getByTestId("editor-undo")).toHaveCount(0);

  const trigger = page.getByTestId("layer-actions");
  const box = (await trigger.boundingBox())!;
  expect(box.x + box.width).toBeLessThanOrEqual(page.viewportSize()!.width);
  await trigger.tap();
  await expect(page.getByTestId("layer-actions-undo")).toBeDisabled();
  await expect(page.getByTestId("layer-actions-discard")).toBeDisabled();
  await page.getByTestId("layer-actions-export").tap();
  await expect(page.getByTestId("layer-export")).toBeVisible();
  await page.getByTestId("layer-export").getByTestId("modal-close").tap();

  // An edit makes undo and discard available from the same menu.
  await rows(page).first().tap();
  await page.getByTestId("item-max-copies").fill("7");
  await expect
    .poll(async () => {
      await trigger.tap();
      const enabled = await page.getByTestId("layer-actions-undo").isEnabled();
      await page.keyboard.press("Escape");
      return enabled;
    })
    .toBe(true);
  await trigger.tap();
  await page.getByTestId("layer-actions-undo").tap();
  await expect(page.getByTestId("item-max-copies")).not.toHaveValue("7");
});

for (const width of [MIN_SUPPORTED_WIDTH, 412]) {
  test(`the list and the forms do not scroll sideways at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 800 });
    await openLayer(page);
    await expectFits(page);

    await rows(page).first().tap();
    await page.getByTestId("show-all-fields").tap();
    await expectFits(page);
    await back(page).tap();

    // A bonus no item carries raises a finding, so the validation list shows too.
    await page.getByTestId("tab-bonuses").tap();
    await page.getByTestId("new-bonus").tap();
    await page.getByTestId("bonus-name-input").fill("ZZZ Phone Bonus");
    await page.getByRole("button", { name: "Save bonus" }).tap();
    await expect(page.getByTestId("validation-drawer")).toBeVisible();
    await expectFits(page);
    await back(page).tap();
    await expectFits(page);

    await page.getByTestId("tab-filters").tap();
    await rows(page).first().tap();
    await expectFits(page);
    await back(page).tap();

    await page.getByTestId("tab-slots").tap();
    await expectFits(page);
    for (const kind of ["section", "slot", "preset"]) {
      await page.locator(`[data-outline-key^="${kind}:"]`).first().tap();
      await expectFormView(page);
      await expectFits(page);
      await back(page).tap();
    }
  });
}

test("a tablet keeps the stacked layout without sideways scroll", async ({
  page,
}) => {
  await page.setViewportSize({ width: 820, height: 1180 });
  await openLayer(page);
  await expect(form(page)).toBeVisible();
  await expect(back(page)).toHaveCount(0);
  await expect(page.getByTestId("layer-export-toggle")).toBeVisible();
  await expectFits(page);

  await rows(page).first().click();
  await page.getByTestId("show-all-fields").click();
  await expectFits(page);
  await page.getByTestId("tab-slots").click();
  await page.locator('[data-outline-key^="slot:"]').first().click();
  await expectFits(page);
});

test("a collapsed desktop entry list still shows on a phone and stays collapsed after", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openBuilder(page);
  await page.getByTestId("nav-add-layer").click();
  await page.getByRole("button", { name: "Hide the entry list" }).click();
  await expect(page.getByTestId("layer-entries-collapsed")).toBeVisible();

  await page.setViewportSize({ width: MIN_SUPPORTED_WIDTH, height: 740 });
  await expectListView(page);

  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(page.getByTestId("layer-entries-collapsed")).toBeVisible();
});
