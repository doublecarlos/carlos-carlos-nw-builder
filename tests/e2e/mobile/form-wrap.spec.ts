// Representative editor forms at phone widths, checked for the ways a form wraps badly: a button
// label broken over lines, anything scrolling sideways, and a FormGrid or SegmentedControl whose
// items on one visual row disagree on top or height. The primitives must pass everywhere; the
// ad-hoc rows still waiting for them are listed in KNOWN_ADHOC.
import { test, expect, type Locator, type Page } from "@playwright/test";
import { openBuilder } from "../support/app";
import { addLayer, layerRow } from "../support/nav";
import { MIN_SUPPORTED_WIDTH } from "../support/viewport";
import {
  brokenFlexRows,
  raggedRows,
  sidewaysScroll,
  wrappedButtons,
} from "../support/formWrap";

const form = (page: Page) => page.getByTestId("layer-form-pane");

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
  await expect(page.getByTestId("layer-entries-column")).toBeVisible();
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

/** Every offender under `scope`, primitives and ad-hoc rows alike. */
async function offenders(scope: Locator) {
  return [
    ...(await wrappedButtons(scope)),
    ...(await sidewaysScroll(scope)),
    ...(await raggedRows(scope)),
    ...(await brokenFlexRows(scope)),
  ];
}

/** The primitives' own offenders: a wrapped segment, or a ragged FormGrid/SegmentedControl. */
async function primitiveOffenders(scope: Locator) {
  return [
    ...(await wrappedButtons(scope, '[data-testid="segmented-group"] button')),
    ...(await raggedRows(scope)),
  ];
}

/**
 * Ad-hoc rows that still wrap, by form, each matched as a substring of its offender text.
 * TODO: part B moves these rows onto the primitives; drop each entry as its row migrates.
 */
const BONUS_ROWS = [
  // BonusInputRowList: id, type, label and default on one wrapping row.
  "repeatable-row wraps as ? | Id | Type",
  // NamedFormulaRowList: name and formula on one wrapping row.
  "repeatable-row wraps as ? | Name / Formula",
];
const KNOWN_ADHOC: Record<string, string[]> = {
  item: [
    // FormBar: the item's header actions break under the title.
    "span.flex.flex-1.flex-wrap.items-center wraps as ? | Show all fields",
    // Class restrictions: a checkbox flow, possibly fine as is.
    "wraps as Barbarian | Bard",
  ],
  bonus: BONUS_ROWS,
  // BonusRows: a tier's header (name, measure, threshold) breaks mid-row.
  "bonus tiers": [...BONUS_ROWS, "wraps as Tier "],
  "bonus variants": BONUS_ROWS,
  "bonus problem": BONUS_ROWS,
};

/** What wraps under `scope`: the primitives' offenders, and ad-hoc ones not yet known. */
async function wrapReport(scope: Locator, name: string) {
  const known = KNOWN_ADHOC[name] ?? [];
  return {
    name,
    primitives: await primitiveOffenders(scope),
    adHoc: (await offenders(scope)).filter(
      (offender) => !known.some((entry) => offender.includes(entry)),
    ),
  };
}

const clean = (name: string) => ({ name, primitives: [], adHoc: [] });

for (const width of [MIN_SUPPORTED_WIDTH, 412]) {
  test.describe(`at ${width}px`, () => {
    test.use({ viewport: { width, height: 800 } });

    test("item form with stats", async ({ page }) => {
      await openLayer(page);
      await page.getByTestId("new-item").tap();
      await page.getByTestId("show-all-fields").tap();
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
      expect(await wrapReport(form(page), "item")).toEqual(clean("item"));
    });

    test("bonus grant payloads", async ({ page }) => {
      await openLayer(page);
      await page.getByTestId("tab-bonuses").tap();
      await page.getByTestId("new-bonus").tap();
      await form(page).getByTestId("add-bonus-input").first().tap();
      await form(page).getByTestId("add-bonus-formula").first().tap();
      await page.getByLabel("Add grant").tap();
      const payload = form(page).getByTestId("grant-payload");
      expect(await wrapReport(form(page), "bonus")).toEqual(clean("bonus"));

      await payload.getByRole("button", { name: "tiered" }).tap();
      await form(page).getByTestId("add-tier").first().tap();
      await form(page)
        .getByTestId("bonus-tier-row")
        .first()
        .getByRole("button", { name: "Add stat", exact: true })
        .first()
        .tap();
      expect(await wrapReport(form(page), "bonus tiers")).toEqual(
        clean("bonus tiers"),
      );

      await payload.getByRole("button", { name: "varies by condition" }).tap();
      await form(page).getByTestId("add-variant").first().tap();
      expect(await wrapReport(form(page), "bonus variants")).toEqual(
        clean("bonus variants"),
      );

      await payload.getByRole("button", { name: "reports a problem" }).tap();
      expect(await wrapReport(form(page), "bonus problem")).toEqual(
        clean("bonus problem"),
      );
    });

    test("slot form", async ({ page }) => {
      await openLayer(page);
      await newInSlotsTab(page, "new-slot");
      expect(await wrapReport(form(page), "slot")).toEqual(clean("slot"));
    });

    test("preset form", async ({ page }) => {
      await openLayer(page);
      await newInSlotsTab(page, "new-preset");
      await page.getByRole("button", { name: "Add a parameter" }).tap();
      expect(await wrapReport(form(page), "preset")).toEqual(clean("preset"));
    });

    test("section form", async ({ page }) => {
      await openLayer(page);
      await newInSlotsTab(page, "new-section");
      expect(await wrapReport(form(page), "section")).toEqual(clean("section"));
    });

    test("build editor quick options", async ({ page }) => {
      await openBuilder(page);
      expect(
        await wrapReport(page.getByTestId("quick-options"), "quick options"),
      ).toEqual(clean("quick options"));
    });
  });
}
