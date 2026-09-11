// End-to-end coverage for the "Import from game" coverage report: the three groups
// (imported / not recognized / not in the demo), the copy-all affordance, multi-loadout tabs,
// and reopening from the post-import notice.
import { test, expect, type Page } from "@playwright/test";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { openBuilder, setItemFilter } from "./support/app";
import { addLayer, layerRow } from "./support/nav";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEMO_FIXTURE = join(__dirname, "../unit/fixtures/build-export.demo.txt");

/** The fixture's `Hitem`s are deliberately synthetic, so no shipped `gameIds` claim them and
 *  the demo recognizes nothing out of the box however far the catalog's own mappings grow.
 *  Teaching one mapping through a layer -- the real mechanism the report relies on -- gives
 *  report an actual "imported" row to assert on, the same way a player would fix an
 *  "unrecognized" id after reading the report. */
async function mapFixtureHeadItem(page: Page) {
  await addLayer(page);
  await layerRow(page, "Layer 1").locator(".nav-name").click();
  await page.getByTestId("new-item").click();
  await page.getByTestId("item-name-input").fill("ZZZ Test Heavyheal Hood");
  await setItemFilter(page, "gear_head");
  const gameIdsInput = page.getByTestId("item-gameids-input").locator("input");
  await gameIdsInput.fill("Head_Heavyheal_Test");
  await gameIdsInput.press("Enter");
  await page.getByRole("button", { name: "Save item" }).click();
}

async function openImportAndUploadFixture(page: Page) {
  await page.getByTestId("header-import-from-game").click();
  await page.getByTestId("game-import-next").click();
  await page.getByTestId("game-import-file-input").setInputFiles(DEMO_FIXTURE);
  await expect(page.getByTestId("game-import-step-loadouts")).toBeVisible();
}

test("all three groups render with correct counts", async ({ page }) => {
  await openBuilder(page);
  await mapFixtureHeadItem(page);
  await openImportAndUploadFixture(page);

  // "1. DPS ST" is the active loadout and pre-selected.
  await page.getByTestId("game-import-commit").click();
  await expect(page.getByTestId("game-import-step-report")).toBeVisible();

  const imported = page.getByTestId("game-import-report-imported");
  await expect(imported.locator("summary")).toHaveText("Imported (1)");
  await expect(
    imported.getByTestId("game-import-report-imported-row"),
  ).toHaveText("Head → ZZZ Test Heavyheal Hood");

  // 5 items in the loadout are equipped-and-namable; one is now recognized above, leaving 4
  // (the mainhand weapon, the stable mount and its two insignia gems).
  const unrecognized = page.getByTestId("game-import-report-unrecognized");
  await expect(unrecognized.locator("summary")).toHaveText(
    "Not recognized (4)",
  );
  await expect(
    unrecognized.getByTestId("game-import-report-unrecognized-row"),
  ).toHaveCount(4);

  const notInDemo = page.getByTestId("game-import-report-not-in-demo");
  await expect(notInDemo.locator("summary")).toHaveText("Not in the demo (12)");
});

test("unrecognized ids are listed and the copy button puts them on the clipboard", async ({
  page,
  context,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await openBuilder(page);
  await openImportAndUploadFixture(page);

  await page.getByTestId("game-import-commit").click();

  const unrecognized = page.getByTestId("game-import-report-unrecognized");
  await expect(
    unrecognized.getByTestId("game-import-report-unrecognized-row"),
  ).toHaveCount(5);
  await expect(unrecognized).toContainText("Head_Heavyheal_Test");

  await page.getByTestId("game-import-report-copy-unrecognized").click();
  const clipboard = await page.evaluate(() => navigator.clipboard.readText());
  // Grouped by bag in game-import.json's own order (known bags first, unmapped ones -- "MainHand"
  // here, the real bag is "Melee" -- alphabetically after), not by demo file order. Split on
  // \r?\n -- the OS clipboard normalizes the joined \n text to CRLF on Windows.
  expect(clipboard.split(/\r?\n/)).toEqual([
    "Head_Heavyheal_Test",
    "Mount_Something_Legendary",
    "Insignia_Barbed_Test",
    "Insignia_Bile_Test",
    "Weapon_MainHand_Something",
  ]);
});

test("'not in demo' is rolled up to sections, not individual slots", async ({
  page,
}) => {
  await openBuilder(page);
  await openImportAndUploadFixture(page);
  await page.getByTestId("game-import-commit").click();

  const notInDemo = page.getByTestId("game-import-report-not-in-demo");
  const rows = notInDemo.getByTestId("game-import-report-notindemo-row");
  // 12 authored groups roll up well over 100 individual missing slots -- a raw per-slot list
  // would be unreadable, which is the whole point of the roll-up.
  await expect(rows).toHaveCount(12);
  await expect(rows.filter({ hasText: "Boons" })).toContainText("boon points");
});

test("tabs appear for a two-loadout import and switch content", async ({
  page,
}) => {
  await openBuilder(page);
  await openImportAndUploadFixture(page);

  await page
    .getByTestId("game-import-loadout-row")
    .filter({ hasText: "aaaaaa" })
    .getByTestId("game-import-loadout-checkbox")
    .click();
  await page.getByTestId("game-import-commit").click();

  const tabs = page.getByTestId("game-import-report-tab");
  await expect(tabs).toHaveCount(2);
  await expect(
    page.getByTestId("game-import-report-unrecognized").locator("summary"),
  ).toHaveText("Not recognized (5)");

  await tabs.filter({ hasText: "aaaaaa" }).click();
  await expect(
    page.getByTestId("game-import-report-unrecognized").locator("summary"),
  ).toHaveText("Not recognized (2)");
});

test("mapping an unrecognized id via the report keeps the row (so it can be re-mapped) and teaches the layer", async ({
  page,
}) => {
  await openBuilder(page);
  await openImportAndUploadFixture(page);
  await page.getByTestId("game-import-commit").click();

  const unrecognized = page.getByTestId("game-import-report-unrecognized");
  const row = unrecognized
    .getByTestId("game-import-report-unrecognized-row")
    .filter({ hasText: "Head_Heavyheal_Test" });
  await row.getByTestId("game-import-report-map-item").click();

  const picker = unrecognized.getByTestId("game-import-report-map-picker");
  await picker.getByTestId("picker-input").click();
  // Index 0 is the picker's own "empty" option; the first real candidate is index 1.
  const firstOption = picker.getByTestId("picker-option").nth(1);
  const firstItemName = (
    await firstOption.locator(".font-semibold").innerText()
  ).trim();
  await firstOption.click();

  // The row stays put -- issue was it used to disappear the moment it resolved, leaving no
  // way to fix a wrong pick. It now shows what it resolved to and offers to change it, and
  // the header count (unlike the row count) drops to reflect the real remainder.
  await expect(row).toContainText(firstItemName);
  await expect(row.getByTestId("game-import-report-map-item")).toHaveText(
    "Change mapping…",
  );
  await expect(
    unrecognized.getByTestId("game-import-report-unrecognized-row"),
  ).toHaveCount(5);
  await expect(unrecognized.locator("summary")).toHaveText(
    "Not recognized (4)",
  );

  const imported = page.getByTestId("game-import-report-imported");
  await expect(imported.locator("summary")).toHaveText("Imported (1)");
  await expect(
    imported.getByTestId("game-import-report-imported-row"),
  ).toHaveText(`Head → ${firstItemName}`);

  // Re-mapping to a different item updates the row and the layer -- and retracts the game id
  // from the first item, so only one item ever claims it.
  await row.getByTestId("game-import-report-map-item").click();
  await picker.getByTestId("picker-input").click();
  const secondOption = picker.getByTestId("picker-option").nth(2);
  const secondItemName = (
    await secondOption.locator(".font-semibold").innerText()
  ).trim();
  await secondOption.click();

  await expect(row).toContainText(secondItemName);
  await expect(
    imported.getByTestId("game-import-report-imported-row"),
  ).toHaveText(`Head → ${secondItemName}`);

  // The mapping landed in a layer overlay ("map to an item" reuses ensureTargetLayer, the
  // same "no layers yet -> create Layer 1" rule Ctrl+click uses), not the base catalog.
  await page.getByTestId("game-import-done").click();
  await layerRow(page, "Layer 1").locator(".nav-name").click();
  await page.locator(".editor-search").fill(secondItemName);
  await page.locator(".editor-row", { hasText: secondItemName }).click();
  await expect(page.getByTestId("item-gameids-input")).toContainText(
    "Head_Heavyheal_Test",
  );

  await page.locator(".editor-search").fill(firstItemName);
  await page.locator(".editor-row", { hasText: firstItemName }).click();
  await expect(page.getByTestId("item-gameids-input")).not.toContainText(
    "Head_Heavyheal_Test",
  );
});

test("reopening from the notice shows the same report", async ({ page }) => {
  await openBuilder(page);
  await openImportAndUploadFixture(page);
  await page.getByTestId("game-import-commit").click();
  await expect(page.getByTestId("game-import-step-report")).toBeVisible();

  await page.getByTestId("game-import-done").click();
  await expect(page.getByTestId("game-import-modal")).toBeHidden();

  await page.getByTestId("notice-action").click();
  await expect(page.getByTestId("game-import-modal")).toBeVisible();
  await expect(page.getByTestId("game-import-step-report")).toBeVisible();
  await expect(
    page.getByTestId("game-import-report-unrecognized").locator("summary"),
  ).toHaveText("Not recognized (5)");
});
