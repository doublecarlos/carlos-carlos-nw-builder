// The stat panel's compare summary and the damage, healing and EHP deltas: those outcomes read
// side by side without switching a picker, each on its own case, and only they say how far
// ahead or behind this build is.
import { test, expect, type Page } from "@playwright/test";
import {
  openBuilder,
  chooseClass,
  chooseCombo,
  chooseItem,
} from "./support/app";
import { buildRow } from "./support/nav";
import { chooseSummaryCase } from "./support/stats";
import { importTestCatalog } from "./support/testCatalog";

const HEAD_ITEM = "Test Summary Head";
const GUARD_ENCHANT = "Test Summary Guard";

const summaryRow = (page: Page, source: string) =>
  page.locator(`[data-summary-row="${source}"]`);

/** Build 1 with more HP and Combat Advantage, then Build 2 compared against it. */
async function openComparedBuild(page: Page) {
  await openBuilder(page);
  await importTestCatalog(page, {
    items: [
      {
        id: "test-summary-head",
        name: HEAD_ITEM,
        filter: "gear_head",
        allowedClass: ["warlock"],
        ca_p: 0.05,
      },
      {
        id: "test-summary-guard",
        name: GUARD_ENCHANT,
        filter: "combat_enchant_defense",
        hit_points_mult: 0.1,
      },
    ],
  });
  await buildRow(page, "Build 1").click();
  await chooseClass(page, "warlock");
  await chooseItem(page, "gear.head", HEAD_ITEM);
  await chooseItem(page, "enchantments.combatDefense", GUARD_ENCHANT);

  await page.getByTestId("nav-add-build").click();
  await chooseClass(page, "warlock");
  await chooseCombo(page.locator(".compare-select"), "Build 1");
}

test("damage, healing and EHP each show both builds at once", async ({
  page,
}) => {
  await openComparedBuild(page);

  for (const source of ["damage", "healing", "ehp"]) {
    const row = summaryRow(page, source);
    await expect(row.getByTestId("summary-value")).toHaveText(/\d/);
    await expect(row.getByTestId("summary-compare-value")).toHaveText(/\d/);
  }
  // Build 1's extra HP puts this build behind on EHP, shown as a signed delta.
  const ehpDelta = summaryRow(page, "ehp").getByTestId("summary-delta");
  await expect(ehpDelta).toHaveText(/^-/);
  await expect(ehpDelta).toHaveAttribute("data-trend", "behind");
});

test("each summary row keeps its own case, across a reload", async ({
  page,
}) => {
  await openBuilder(page);

  await chooseSummaryCase(page, "ehp", "Crit / deflect");
  await expect(summaryRow(page, "ehp")).toHaveAttribute(
    "data-summary-case",
    "critDeflect",
  );
  // Picking EHP's case leaves damage's alone.
  await expect(summaryRow(page, "damage")).toHaveAttribute(
    "data-summary-case",
    "average",
  );

  await page.reload();
  await openBuilder(page);
  await expect(summaryRow(page, "ehp")).toHaveAttribute(
    "data-summary-case",
    "critDeflect",
  );
});

test("only the damage, healing and EHP cases carry a delta", async ({
  page,
}) => {
  await openComparedBuild(page);
  await page.getByRole("checkbox", { name: "Compare stats" }).check();

  // Build 1's extra HP puts this build behind on every EHP case.
  const ehpAverage = page
    .locator('[data-stat-table="ehp"] [data-stat-row="average"]')
    .getByTestId("stat-delta");
  await expect(ehpAverage).toHaveText(/^-\d+(\.\d+)?%$/);
  await expect(ehpAverage).toHaveAttribute("data-trend", "behind");

  // Plain stats keep just the compare line: a delta on every one of them is noise.
  for (const key of ["hp", "ca"]) {
    const row = page.locator(`[data-stat-row="${key}"]`);
    await expect(row.getByTestId("compare-line").first()).toBeVisible();
    await expect(row.getByTestId("stat-delta")).toHaveCount(0);
  }
});

test("opening one row's case menu closes another's", async ({ page }) => {
  await openBuilder(page);
  const menus = page.getByTestId("summary-case-menu").filter({ visible: true });

  await summaryRow(page, "damage").getByTestId("summary-case").click();
  await expect(menus).toHaveCount(1);
  await summaryRow(page, "ehp").getByTestId("summary-case").click();

  // One menu at a time, and it is the one just opened.
  await expect(menus).toHaveCount(1);
  await expect(
    summaryRow(page, "ehp").getByTestId("summary-case"),
  ).toHaveAttribute("aria-expanded", "true");
  await expect(
    summaryRow(page, "damage").getByTestId("summary-case"),
  ).toHaveAttribute("aria-expanded", "false");
});
