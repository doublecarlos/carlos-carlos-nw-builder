// The "Import from game" wizard: entry point, parsing, loadout selection and committing. The
// coverage report shown on commit has its own spec, game-import-report.spec.ts.
import { test, expect } from "@playwright/test";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  openBuilder,
  ensureSectionExpanded,
  pickerInput,
  slotRow,
} from "./support/app";
import { shippedItemName } from "./support/shippedData";
import { buildRow } from "./support/nav";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEMO_FIXTURE = join(__dirname, "../unit/fixtures/build-export.demo.txt");
const LOADOUT_ORDER_FIXTURE = join(
  __dirname,
  "../unit/fixtures/build-export-loadout-order.demo.txt",
);
const GARBAGE_FIXTURE = join(__dirname, "fixtures/garbage.txt");

test("header button opens the wizard on the instructions step", async ({
  page,
}) => {
  await openBuilder(page);
  await page.getByTestId("header-import-from-game").click();
  await expect(page.getByTestId("game-import-modal")).toBeVisible();
  await expect(page.getByTestId("game-import-step-instructions")).toBeVisible();
});

test("the demo_record command is present and copyable", async ({ page }) => {
  await openBuilder(page);
  await page.getByTestId("header-import-from-game").click();
  await expect(page.getByTestId("game-import-command")).toHaveText(
    "/demo_record build_export $$ demo_record_stop",
  );
  await expect(page.getByRole("button", { name: "Copy" })).toBeEnabled();
});

test("uploading the fixture advances to the loadout list with the right names, active loadout badged and pre-selected", async ({
  page,
}) => {
  await openBuilder(page);
  await page.getByTestId("header-import-from-game").click();
  await page.getByTestId("game-import-next").click();
  await page.getByTestId("game-import-file-input").setInputFiles(DEMO_FIXTURE);

  await expect(page.getByTestId("game-import-step-loadouts")).toBeVisible();
  const rows = page.getByTestId("game-import-loadout-row");
  await expect(rows).toHaveCount(2);
  await expect(rows.filter({ hasText: "1. DPS ST" })).toBeVisible();
  await expect(rows.filter({ hasText: "aaaaaa" })).toBeVisible();

  const activeRow = rows.filter({ hasText: "1. DPS ST" });
  await expect(activeRow.getByTestId("game-import-active-badge")).toBeVisible();
  await expect(
    activeRow.getByTestId("game-import-loadout-checkbox"),
  ).toBeChecked();
  await expect(
    rows
      .filter({ hasText: "aaaaaa" })
      .getByTestId("game-import-loadout-checkbox"),
  ).not.toBeChecked();
});

test("loadouts are listed alphabetically, not in recording order", async ({
  page,
}) => {
  await openBuilder(page);
  await page.getByTestId("header-import-from-game").click();
  await page.getByTestId("game-import-next").click();
  await page
    .getByTestId("game-import-file-input")
    .setInputFiles(LOADOUT_ORDER_FIXTURE);

  // The fixture records "Zulu Solo" first; the game's own switcher lists alphabetically.
  const rows = page.getByTestId("game-import-loadout-row");
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(0)).toContainText("aaaaaa");
  await expect(rows.nth(1)).toContainText("Zulu Solo");
});

test("selecting two loadouts and confirming creates two builds in the nav with the expected names", async ({
  page,
}) => {
  await openBuilder(page);
  await page.getByTestId("header-import-from-game").click();
  await page.getByTestId("game-import-next").click();
  await page.getByTestId("game-import-file-input").setInputFiles(DEMO_FIXTURE);

  const rows = page.getByTestId("game-import-loadout-row");
  await rows
    .filter({ hasText: "aaaaaa" })
    .getByTestId("game-import-loadout-checkbox")
    .click();

  await page.getByTestId("game-import-commit").click();

  await expect(buildRow(page, "Carlos o Bardo - 1. DPS ST")).toBeVisible();
  await expect(buildRow(page, "Carlos o Bardo - aaaaaa")).toBeVisible();

  // Commit lands on the coverage report step, not a closed wizard.
  await expect(page.getByTestId("game-import-step-report")).toBeVisible();
  await page.getByTestId("game-import-done").click();
  await expect(page.getByTestId("game-import-modal")).toBeHidden();
});

test("an imported build starts on the generic companion and mount combat power", async ({
  page,
}) => {
  await openBuilder(page);
  await page.getByTestId("header-import-from-game").click();
  await page.getByTestId("game-import-next").click();
  await page.getByTestId("game-import-file-input").setInputFiles(DEMO_FIXTURE);
  await page.getByTestId("game-import-commit").click();
  await page.getByTestId("game-import-done").click();

  await buildRow(page, "Carlos o Bardo - 1. DPS ST").click();
  await ensureSectionExpanded(page, "companions");
  await expect(pickerInput(slotRow(page, "companions.companion"))).toHaveValue(
    shippedItemName("generic-companion"),
  );
  await ensureSectionExpanded(page, "mounts");
  await expect(pickerInput(slotRow(page, "mounts.mountCombat"))).toHaveValue(
    shippedItemName("mount-combat-power-celestial"),
  );
});

test("a garbage file shows the 'not a demo file' message and does not create a build", async ({
  page,
}) => {
  await openBuilder(page);
  await page.getByTestId("header-import-from-game").click();
  await page.getByTestId("game-import-next").click();
  await page
    .getByTestId("game-import-file-input")
    .setInputFiles(GARBAGE_FIXTURE);

  await expect(page.getByTestId("game-import-error")).toBeVisible();
  await expect(page.getByTestId("game-import-step-loadouts")).toBeHidden();
  await expect(buildRow(page, "Carlos o Bardo")).toBeHidden();
});

test("Escape closes the wizard without committing", async ({ page }) => {
  await openBuilder(page);
  await page.getByTestId("header-import-from-game").click();
  await page.getByTestId("game-import-next").click();
  await page.getByTestId("game-import-file-input").setInputFiles(DEMO_FIXTURE);
  await expect(page.getByTestId("game-import-step-loadouts")).toBeVisible();

  await page.keyboard.press("Escape");

  await expect(page.getByTestId("game-import-modal")).toBeHidden();
  await expect(buildRow(page, "Carlos o Bardo")).toBeHidden();
});
