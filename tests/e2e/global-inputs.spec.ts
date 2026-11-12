// A global input is one value several bonuses read. It has no row of its own: its control
// shows on every equipped reader's row, and editing it on one row changes them all.
import { test, expect, type Page } from "@playwright/test";
import {
  bonusInputControl,
  chooseCombo,
  chooseItem,
  ensureSectionExpanded,
  headerRow,
  openBuilder,
  slotRow,
} from "./support/app";
import { importTestCatalog } from "./support/testCatalog";
import type { Bonus } from "../../src/types";

const GLOBALS = "test-globals";
const SONG = `${GLOBALS}.song`;
const LUTE = "Test Lute Ring";
const DRUM = "Test Drum Ring";
const PLAIN = "Test Plain Ring";

/** A bonus reading the song under its own local name. */
const reader = (id: string, name: string, local: string): Bonus => ({
  id,
  name,
  inputs: { [local]: { global: SONG } },
  grants: [{ when: { input: { key: local, is: true } }, stats: { power: 5 } }],
});

async function openWithReaders(page: Page, choices: Record<string, string>) {
  await openBuilder(page);
  await importTestCatalog(page, {
    items: [
      {
        id: "test-lute",
        name: LUTE,
        filter: "gear_ring",
        bonuses: ["test-ballad"],
      },
      {
        id: "test-drum",
        name: DRUM,
        filter: "gear_ring",
        bonuses: ["test-chorus"],
      },
      { id: "test-plain", name: PLAIN, filter: "gear_ring" },
    ],
    bonuses: [
      reader("test-ballad", "Test Ballad", "song"),
      reader("test-chorus", "Test Chorus", "sang"),
    ],
    slots: [
      {
        id: `${GLOBALS}.note`,
        section: GLOBALS,
        type: "text",
        text: "Shared circumstances",
      },
      {
        id: SONG,
        label: "Played a song",
        section: GLOBALS,
        type: "build_parameter",
        paramType: "boolean",
        path: "test.song",
        default: false,
        globalInput: true,
      },
    ],
    sections: [
      {
        id: GLOBALS,
        label: "Test Global Inputs",
        slotIds: [`${GLOBALS}.note`, SONG],
      },
    ],
    choices,
  });
  await ensureSectionExpanded(page, "gear");
}

const lute = (page: Page) =>
  bonusInputControl(slotRow(page, "gear.ring1"), "test-ballad", "song");
const drum = (page: Page) =>
  bonusInputControl(slotRow(page, "gear.ring2"), "test-chorus", "sang");

test("the control shows on every reader's row and edits one shared value", async ({
  page,
}) => {
  await openWithReaders(page, {
    "gear.ring1": "test-lute",
    "gear.ring2": "test-drum",
  });
  await expect(lute(page)).not.toBeChecked();
  await expect(drum(page)).not.toBeChecked();

  await lute(page).check();
  await expect(drum(page)).toBeChecked();
  // Each row names the other reader, so a change here is not a surprise there.
  await expect(
    page.getByTestId("bonus-input-test-ballad-song-shared"),
  ).toHaveText("Shared with Test Chorus");
  await expect(
    page.getByTestId("bonus-input-test-chorus-sang-shared"),
  ).toHaveText("Shared with Test Ballad");

  await drum(page).uncheck();
  await expect(lute(page)).not.toBeChecked();
});

test("the global input has no row or section, and shows only with a reader equipped", async ({
  page,
}) => {
  await openWithReaders(page, { "gear.ring1": "test-lute" });
  // Its section holds nothing else, so the empty-section rule hides it.
  await expect(headerRow(page, GLOBALS)).toBeHidden();
  await expect(headerRow(page, "gear")).toBeVisible();
  await expect(slotRow(page, SONG)).toHaveCount(0);

  // A lone reader has no one to share with.
  await expect(lute(page)).toBeVisible();
  await expect(
    page.getByTestId("bonus-input-test-ballad-song-shared"),
  ).toHaveCount(0);
  await lute(page).check();

  await chooseItem(page, "gear.ring1", PLAIN);
  await expect(lute(page)).toHaveCount(0);
  await expect(page.getByTestId(/^bonus-input-/)).toHaveCount(0);

  // The value stays stored, so the reader comes back with the player's setting.
  await chooseItem(page, "gear.ring1", LUTE);
  await expect(lute(page)).toBeChecked();
});

test("only showing changes keeps a reader row whose one difference is the global input", async ({
  page,
}) => {
  await openWithReaders(page, { "gear.ring1": "test-lute" });

  await page.getByTestId("nav-add-build").click();
  await ensureSectionExpanded(page, "gear");
  await chooseItem(page, "gear.ring1", LUTE);
  await lute(page).check();
  await chooseCombo(page.locator(".compare-select"), "Test catalog");
  await page.getByRole("checkbox", { name: "Only show changes" }).check();

  // The global input has no row, so its difference surfaces on the reader's.
  await expect(slotRow(page, "gear.ring1")).toBeVisible();
  await expect(slotRow(page, "gear.ring2")).toBeHidden();
  await expect(page.getByTestId("slot-filter-count")).toHaveText(/^\s*1\b/);
});
