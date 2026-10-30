// The phone's Back closes whatever covers the screen before it leaves the page: the nav drawer,
// the item card sheet, every modal, and the layer editor's form. Closing any of them another
// way leaves no history entry behind, so the next Back goes where it would have before.
import { test, expect, type Page } from "@playwright/test";
import { chooseItem, ensureSectionExpanded, openBuilder } from "../support/app";
import {
  addBuild,
  addLayer,
  buildRow,
  confirmDialog,
  openRowMenu,
} from "../support/nav";
const HEAD_ITEM = "M29 Enchanted Depthweave Cap";

const hamburger = (page: Page) => page.getByTestId("header-nav-toggle");
const drawer = (page: Page) => page.getByTestId("nav-drawer");
const kebab = (page: Page) => page.getByTestId("header-menu");
const menuEntry = (page: Page, action: string) =>
  page.getByTestId(`header-menu-${action}`);

const buildParam = (page: Page) =>
  new URL(page.url()).searchParams.get("build");

/** Whether the current history entry is an overlay's Back marker. */
const onMarker = (page: Page) =>
  page.evaluate(() => Boolean(history.state?.backToClose));

async function openDrawer(page: Page) {
  if (!(await drawer(page).isVisible())) await hamburger(page).click();
  await expect(drawer(page)).toBeVisible();
}

/** Two builds, the second open, with the first one entry back. Returns both URLs. */
async function twoBuilds(page: Page) {
  await openBuilder(page);
  const first = page.url();
  await openDrawer(page);
  await addBuild(page);
  await expect(drawer(page)).toHaveCount(0);
  await expect.poll(() => page.url()).not.toBe(first);
  return { first, second: page.url() };
}

/** Back from here lands on `url`, proving nothing was left above it. */
async function expectBackTo(page: Page, url: string) {
  await expect.poll(() => onMarker(page)).toBe(false);
  await page.goBack();
  await expect.poll(() => page.url()).toBe(url);
}

test("Back closes the nav drawer and stays on the build", async ({ page }) => {
  const { first, second } = await twoBuilds(page);

  await openDrawer(page);
  await page.goBack();
  await expect(drawer(page)).toHaveCount(0);
  expect(page.url()).toBe(second);
  await expect(page.getByTestId("editor-pane")).toBeVisible();

  await openDrawer(page);
  await drawer(page).getByTestId("sheet-close").click();
  await expect(drawer(page)).toHaveCount(0);
  await expectBackTo(page, first);
});

test("a pick in the drawer is one Back away, with no step in between", async ({
  page,
}) => {
  const { first, second } = await twoBuilds(page);
  const firstId = new URL(first).searchParams.get("build");

  await openDrawer(page);
  await page.locator(".nav-row--build").first().locator(".nav-name").click();
  await expect(drawer(page)).toHaveCount(0);
  await expect.poll(() => buildParam(page)).toBe(firstId);

  await expectBackTo(page, second);
});

test("a dialog opened from the drawer closes before the drawer", async ({
  page,
}) => {
  const { first, second } = await twoBuilds(page);

  await openDrawer(page);
  const row = buildRow(page, "Build 1");
  const menu = await openRowMenu(row);
  await menu.getByRole("button", { name: "Delete…" }).click();
  await expect(confirmDialog(page)).toBeVisible();

  // Back on a confirmation is its cancel.
  await page.goBack();
  await expect(confirmDialog(page)).toHaveCount(0);
  await expect(drawer(page)).toBeVisible();
  await expect(row).toBeVisible();

  await page.goBack();
  await expect(drawer(page)).toHaveCount(0);
  expect(page.url()).toBe(second);
  await expectBackTo(page, first);
});

test("Back closes the item card sheet", async ({ page }) => {
  const { first, second } = await twoBuilds(page);
  await chooseItem(page, "gear.head", HEAD_ITEM);
  const sheet = page.getByTestId("item-card-sheet");

  await page.getByTestId("slot-info:gear.head").click();
  await expect(sheet).toBeVisible();
  await page.goBack();
  await expect(sheet).toHaveCount(0);
  expect(page.url()).toBe(second);

  await page.getByTestId("slot-info:gear.head").click();
  await sheet.getByTestId("sheet-close").click();
  await expect(sheet).toHaveCount(0);
  await expectBackTo(page, first);
});

/** Each full-screen modal, and how to open it from the build editor. */
const MODALS: {
  name: string;
  testid: string;
  open: (page: Page) => Promise<void>;
}[] = [
  {
    name: "about",
    testid: "about-dialog",
    open: async (page) => {
      await kebab(page).click();
      await menuEntry(page, "about").click();
    },
  },
  {
    name: "bundle export",
    testid: "bundle-export-picker",
    open: async (page) => {
      await kebab(page).click();
      await menuEntry(page, "export").click();
    },
  },
  {
    name: "game import",
    testid: "game-import-modal",
    open: async (page) => {
      await kebab(page).click();
      await menuEntry(page, "importFromGame").click();
    },
  },
  {
    name: "go-to palette",
    testid: "go-to-palette",
    open: async (page) => {
      await page.getByTestId("header-go-to").click();
    },
  },
  {
    name: "stable browser for a group",
    testid: "stable-browser",
    open: async (page) => {
      await ensureSectionExpanded(page, "insignia");
      await page.getByTestId("open-stable-browser:insignia.mount1").click();
    },
  },
];

for (const modal of MODALS) {
  test(`Back closes the ${modal.name}`, async ({ page }) => {
    const { first, second } = await twoBuilds(page);
    const dialog = page.getByTestId(modal.testid);

    await modal.open(page);
    await expect(dialog).toBeVisible();
    await page.goBack();
    await expect(dialog).toHaveCount(0);
    expect(page.url()).toBe(second);

    await modal.open(page);
    await expect(dialog).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expectBackTo(page, first);
  });
}

test("Back closes the stable reference through its own route", async ({
  page,
}) => {
  const { second } = await twoBuilds(page);
  const dialog = page.getByTestId("stable-browser");

  await kebab(page).click();
  await menuEntry(page, "stable").click();
  await expect(dialog).toBeVisible();
  await expect
    .poll(() => new URL(page.url()).searchParams.get("stable"))
    .toBe("mount");
  await expect.poll(() => onMarker(page)).toBe(false);

  await page.goBack();
  await expect(dialog).toHaveCount(0);
  await expect.poll(() => page.url()).toBe(second);
});

test.describe("the layer editor", () => {
  const list = (page: Page) => page.getByTestId("layer-entries-column");
  const form = (page: Page) => page.getByTestId("layer-form-pane");

  /** Opens a new layer from a build. Returns the build's URL, the entry before the layer's. */
  async function openLayer(page: Page) {
    await openBuilder(page);
    const before = page.url();
    await openDrawer(page);
    await addLayer(page);
    await expect(list(page)).toBeVisible();
    await expect.poll(() => page.url()).not.toBe(before);
    return { before, layer: page.url() };
  }

  test("Back runs form, list, then the build", async ({ page }) => {
    const { before, layer } = await openLayer(page);

    await page.locator(".editor-row").nth(3).tap();
    await expect(form(page)).toBeVisible();
    await page.goBack();
    await expect(form(page)).toHaveCount(0);
    await expect(list(page)).toBeVisible();
    expect(new URL(page.url()).searchParams.get("layer")).toBe(
      new URL(layer).searchParams.get("layer"),
    );

    await expectBackTo(page, before);
  });

  test("the in-app Back to list leaves no entry behind", async ({ page }) => {
    const { before } = await openLayer(page);

    await page.locator(".editor-row").nth(3).tap();
    await page.getByTestId("layer-form-back").tap();
    await expect(list(page)).toBeVisible();
    await page.getByTestId("new-item").tap();
    await expect(form(page)).toBeVisible();
    await page.getByTestId("layer-form-back").tap();
    await expect(list(page)).toBeVisible();

    await expectBackTo(page, before);
  });

  test("a dirty draft asks on Back, and cancelling keeps Back working", async ({
    page,
  }) => {
    const { before, layer } = await openLayer(page);
    await page.getByTestId("new-item").tap();
    await page.getByTestId("item-name-input").fill("ZZZ Back Draft");

    await page.goBack();
    await expect(confirmDialog(page)).toBeVisible();
    await page.getByTestId("confirm-cancel").tap();
    await expect(form(page)).toBeVisible();
    await expect(page.getByTestId("item-name-input")).toHaveValue(
      "ZZZ Back Draft",
    );

    // Back on the dialog itself cancels too.
    await page.goBack();
    await expect(confirmDialog(page)).toBeVisible();
    await page.goBack();
    await expect(confirmDialog(page)).toHaveCount(0);
    await expect(form(page)).toBeVisible();

    await page.goBack();
    await page.getByTestId("confirm-accept").tap();
    await expect(form(page)).toHaveCount(0);
    await expect(list(page)).toBeVisible();
    expect(page.url()).toBe(layer);

    await expectBackTo(page, before);
  });
});
