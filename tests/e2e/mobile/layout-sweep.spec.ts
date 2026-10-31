// Representative screens at phone widths, checked for the ways a layout breaks on a narrow
// screen: a button label broken over lines, anything scrolling sideways (the page or a box
// inside it), and a FormGrid or SegmentedControl whose items on one row disagree on top or
// height. This is where "it fits a phone" lives; the per-screen specs pin behavior and the
// deliberate layout choices of each screen.
import { test, expect, type Locator, type Page } from "@playwright/test";
import { chooseItem, ensureSectionExpanded, openBuilder } from "../support/app";
import { openWithBonusInputs } from "../support/bonusInputBuild";
import { openDrawer, openNewLayer } from "../support/nav";
import { MIN_SUPPORTED_WIDTH } from "../support/viewport";
import {
  raggedRows,
  sidewaysScroll,
  wrappedButtons,
} from "../support/formWrap";
import { importTestCatalog } from "../support/testCatalog";
import { showAllFields } from "../support/layerEditor";

const HEAD_ITEM = "Test Head With A Long Enough Name To Wrap";

/** A head with a long name, stats and a bonus, so its card and the stats have content. */
const importHead = (page: Page) =>
  importTestCatalog(page, {
    items: [
      {
        id: "test-layout-head",
        name: HEAD_ITEM,
        filter: "gear_head",
        strike: 1000,
        forte: 1000,
        combined_rating: 1000,
        bonuses: ["test-layout-head-bonus"],
      },
    ],
    bonuses: [
      {
        id: "test-layout-head-bonus",
        name: "Test Layout Head Bonus",
        grants: [{ stats: { ca_p: 0.1 } }],
      },
    ],
  });

const form = (page: Page) => page.getByTestId("layer-form-pane");

/** Every offender under `scope`, once it shows. `ownScrollers` are the testids of boxes
 *  that scroll sideways by design. */
async function offenders(scope: Locator, ownScrollers: string[] = []) {
  await expect(scope).toBeVisible();
  return [
    ...(await wrappedButtons(scope)),
    ...(await sidewaysScroll(scope, ownScrollers)),
    ...(await raggedRows(scope)),
  ];
}

async function newInSlotsTab(
  page: Page,
  what: "new-section" | "new-slot" | "new-preset",
) {
  await page.getByTestId("tab-slots").tap();
  await page.getByTestId("new-slot-entry").tap();
  await page.getByTestId(what).tap();
  await expect(form(page)).toBeVisible();
}

/** Picks an option of the ComboBox with `testid` under `scope`. */
async function pick(
  page: Page,
  scope: Locator,
  testid: string,
  option: string,
) {
  await scope.getByTestId(testid).first().tap();
  await page.getByRole("option", { name: option, exact: true }).tap();
}

async function openStableBrowser(page: Page) {
  await openBuilder(page);
  await ensureSectionExpanded(page, "insignia");
  await page.getByTestId("open-stable-browser:insignia.mount1").click();
}

for (const width of [MIN_SUPPORTED_WIDTH, 412]) {
  test.describe(`at ${width}px`, () => {
    test.use({ viewport: { width, height: 800 } });

    test("landing", async ({ page }) => {
      await page.goto("/");
      await expect(page.getByTestId("landing-new-build")).toBeVisible({
        timeout: 15000,
      });
      expect(await offenders(page.locator("body")), "landing").toEqual([]);
    });

    test("build editor, its menus and the item card", async ({ page }) => {
      await openBuilder(page);
      await importHead(page);
      await chooseItem(page, "gear.head", HEAD_ITEM);
      expect(
        await offenders(page.getByTestId("editor-pane")),
        "editor",
      ).toEqual([]);

      await page.getByTestId("editor-actions").click();
      expect(
        await offenders(page.locator("body")),
        "editor actions menu",
      ).toEqual([]);
      await page.keyboard.press("Escape");

      await page.getByTestId("header-menu").click();
      expect(await offenders(page.locator("body")), "header menu").toEqual([]);
      await page.keyboard.press("Escape");

      await page.getByTestId("slot-info:gear.head").click();
      expect(
        await offenders(page.getByTestId("item-card-sheet")),
        "item card",
      ).toEqual([]);
    });

    test("build rows with bonus inputs", async ({ page }) => {
      const row = await openWithBonusInputs(page);
      await expect(row.getByTestId("input-row").first()).toBeVisible();
      expect(
        await offenders(page.getByTestId("editor-pane")),
        "bonus inputs",
      ).toEqual([]);
    });

    test("nav drawer", async ({ page }) => {
      await openBuilder(page);
      await openDrawer(page);
      expect(await offenders(page.getByTestId("nav-drawer")), "drawer").toEqual(
        [],
      );
    });

    test("stats pane", async ({ page }) => {
      await openBuilder(page);
      await importHead(page);
      await chooseItem(page, "gear.head", HEAD_ITEM);
      await page.getByTestId("pane-stats").click();
      const stats = page.getByTestId("stat-panel-column");
      await expect(stats).toContainText("Ratings");
      // Tables scroll inside their own box when their numbers need the room.
      expect(await offenders(stats, ["stat-table-scroll"]), "stats").toEqual(
        [],
      );
      await page.getByRole("button", { name: /Bonuses/ }).click();
      await expect(page.getByTestId("bonus-filter")).toBeVisible();
      expect(await offenders(stats, ["stat-table-scroll"]), "bonuses").toEqual(
        [],
      );
    });

    test("layer editor lists", async ({ page }) => {
      await openNewLayer(page);
      const pane = page.getByTestId("layer-entries-column");
      expect(await offenders(pane), "item list").toEqual([]);

      // A bonus no item carries raises a finding, so the validation list shows too.
      await page.getByTestId("tab-bonuses").tap();
      await page.getByTestId("new-bonus").tap();
      await page.getByTestId("bonus-name-input").fill("ZZZ Phone Bonus");
      await page.getByRole("button", { name: "Save bonus" }).tap();
      // The validation list belongs to the list view, with the layer header.
      await page.getByTestId("layer-form-back").tap();
      await expect(page.getByTestId("validation-drawer")).toBeVisible();
      expect(await offenders(page.locator("body")), "validation").toEqual([]);
      expect(await offenders(pane), "bonus list").toEqual([]);

      await page.getByTestId("tab-slots").tap();
      await expect(page.getByTestId("slot-outline")).toBeVisible();
      expect(await offenders(pane), "slot outline").toEqual([]);
    });

    test("item form with stats", async ({ page }) => {
      await openNewLayer(page);
      await page.getByTestId("new-item").tap();
      await showAllFields(page);
      for (const add of [
        "Add stat",
        "Add dynamic stat",
        "Add insignia slot",
        "Add default build parameter",
        "Add published value",
      ])
        await form(page)
          .getByRole("button", { name: add, exact: true })
          .first()
          .tap();
      await form(page).getByTestId("add-inline-repetition").tap();
      expect(await offenders(form(page)), "item").toEqual([]);
    });

    test("bonus grant payloads", async ({ page }) => {
      await openNewLayer(page);
      await page.getByTestId("tab-bonuses").tap();
      await page.getByTestId("new-bonus").tap();
      await form(page).getByTestId("add-bonus-input").first().tap();
      await pick(page, form(page), "bonus-input-type", "number");
      await form(page).getByTestId("add-bonus-formula").first().tap();
      await page.getByLabel("Add grant").tap();
      const payload = form(page).getByTestId("grant-payload");
      expect(await offenders(form(page)), "bonus").toEqual([]);

      await payload.getByRole("button", { name: "tiered" }).tap();
      await form(page).getByTestId("add-tier").first().tap();
      await form(page)
        .getByTestId("bonus-tier-row")
        .first()
        .getByRole("button", { name: "Add stat", exact: true })
        .first()
        .tap();
      expect(await offenders(form(page)), "bonus tiers").toEqual([]);

      await payload.getByRole("button", { name: "varies by condition" }).tap();
      await form(page).getByTestId("add-variant").first().tap();
      expect(await offenders(form(page)), "bonus variants").toEqual([]);

      await payload.getByRole("button", { name: "reports a problem" }).tap();
      expect(await offenders(form(page)), "bonus problem").toEqual([]);
    });

    test("condition tree three groups deep, and its editor", async ({
      page,
    }) => {
      await openNewLayer(page);
      await page.getByTestId("tab-slots").tap();
      await page.locator(".editor-search").fill("Arms");
      await page.locator(".editor-row", { hasText: "Arms" }).first().tap();
      await page.getByTestId("slot-when-json-toggle").tap();
      await page.getByTestId("slot-when-json").fill(
        JSON.stringify({
          any: [
            { all: [{ not: { class: "wizard" } }, { toggle: "combat" }] },
            { enemies: { atLeast: 1 } },
          ],
        }),
      );
      await page.getByTestId("slot-when-json-toggle").tap();
      const tree = page.getByTestId("slot-when");
      await expect(tree.getByTestId("condition-op-label")).toHaveCount(3);
      expect(await offenders(form(page)), "condition tree").toEqual([]);

      await tree.getByTestId("condition-summary").first().tap();
      expect(
        await offenders(page.getByTestId("condition-editor")),
        "condition editor",
      ).toEqual([]);
    });

    test("slot form", async ({ page }) => {
      await openNewLayer(page);
      await newInSlotsTab(page, "new-slot");
      expect(await offenders(form(page)), "slot").toEqual([]);
    });

    test("slot form with inline options", async ({ page }) => {
      await openNewLayer(page);
      await newInSlotsTab(page, "new-slot");
      await pick(page, form(page), "slot-type-input", "list");
      await form(page).getByRole("button", { name: "Add an option" }).tap();
      await expect(form(page).getByTestId("slot-option-label-0")).toBeVisible();
      expect(await offenders(form(page)), "slot options").toEqual([]);
    });

    test("filter form", async ({ page }) => {
      await openNewLayer(page);
      await page.getByTestId("tab-filters").tap();
      await page.getByTestId("new-filter").tap();
      expect(await offenders(form(page)), "filter").toEqual([]);
    });

    test("preset form", async ({ page }) => {
      await openNewLayer(page);
      await newInSlotsTab(page, "new-preset");
      await page.getByRole("button", { name: "Add a parameter" }).tap();
      expect(await offenders(form(page)), "preset").toEqual([]);
    });

    test("section form", async ({ page }) => {
      await openNewLayer(page);
      await newInSlotsTab(page, "new-section");
      expect(await offenders(form(page)), "section").toEqual([]);
    });

    test("layer export", async ({ page }) => {
      await openNewLayer(page);
      await page.getByTestId("layer-actions").tap();
      await page.getByTestId("layer-actions-export").tap();
      expect(
        await offenders(page.getByTestId("layer-export")),
        "layer export",
      ).toEqual([]);
    });

    test("stable browser", async ({ page }) => {
      await openStableBrowser(page);
      expect(
        await offenders(page.getByTestId("stable-browser")),
        "stable browser",
      ).toEqual([]);
    });

    test("stable browser bonuses", async ({ page }) => {
      await openStableBrowser(page);
      await page.getByTestId("stable-tab-bonus").click();
      expect(
        await offenders(page.getByTestId("stable-browser")),
        "stable bonuses",
      ).toEqual([]);
    });
  });
}
