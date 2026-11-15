// A global input is one value several bonuses read. Its control shows on every equipped
// reader's row and on a row of its own in its section, and editing one changes them all. While
// no reader is equipped it shows nowhere.
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
      {
        id: "test-duet",
        name: "Test Duet Ring",
        filter: "gear_ring",
        bonuses: ["test-ballad", "test-chorus"],
      },
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
  // Each control's mark names the other rows, so a change here is not a surprise there.
  await expect(
    page.getByTestId("bonus-input-test-ballad-song-shared"),
  ).toHaveAttribute("aria-label", "Shared input, also on Ring 2");
  await expect(
    page.getByTestId("bonus-input-test-chorus-sang-shared"),
  ).toHaveAttribute("aria-label", "Shared input, also on Ring 1");

  await drum(page).uncheck();
  await expect(lute(page)).not.toBeChecked();
});

test("the section shows the global input only with a reader equipped", async ({
  page,
}) => {
  await openWithReaders(page, { "gear.ring1": "test-lute" });
  await ensureSectionExpanded(page, GLOBALS);
  const own = slotRow(page, SONG).getByRole("checkbox");
  await expect(own).toBeVisible();
  await expect(page.getByText("Shared circumstances")).toBeVisible();
  await expect(page.getByTestId(`slot-used-by:${SONG}`)).toHaveText(
    "Used by Ring 1",
  );

  // A lone reader still marks the value as shared, with no other row to name.
  await expect(lute(page)).toBeVisible();
  await expect(
    page.getByTestId("bonus-input-test-ballad-song-shared"),
  ).toHaveAttribute("aria-label", "Shared input");
  await own.check();
  await expect(lute(page)).toBeChecked();

  // With no reader left the section has no field, so it hides with its text row.
  await chooseItem(page, "gear.ring1", PLAIN);
  await expect(lute(page)).toHaveCount(0);
  await expect(page.getByTestId(/^bonus-input-/)).toHaveCount(0);
  await expect(headerRow(page, GLOBALS)).toBeHidden();
  await expect(headerRow(page, "gear")).toBeVisible();
  await expect(slotRow(page, SONG)).toBeHidden();

  // The value stays stored, so the reader comes back with the player's setting.
  await chooseItem(page, "gear.ring1", LUTE);
  await expect(lute(page)).toBeChecked();
});

test("used by lists every equipped reader, each a link to its row", async ({
  page,
}) => {
  await openWithReaders(page, {
    "gear.ring1": "test-lute",
    "gear.ring2": "test-drum",
  });
  await ensureSectionExpanded(page, GLOBALS);
  const usedBy = page.getByTestId(`slot-used-by:${SONG}`);
  await expect(usedBy).toHaveText("Used by Ring 1, Ring 2");

  await usedBy.getByTestId("slot-used-by-link").last().click();
  await expect(slotRow(page, "gear.ring2")).toBeInViewport();
  await expect(
    slotRow(page, "gear.ring2").locator("[data-cursor-anchor]"),
  ).toBeFocused();
});

test("only showing changes keeps the global input's row and a reader row whose one difference is it", async ({
  page,
}) => {
  await openWithReaders(page, { "gear.ring1": "test-lute" });

  await page.getByTestId("nav-add-build").click();
  await ensureSectionExpanded(page, "gear");
  await chooseItem(page, "gear.ring1", LUTE);
  await lute(page).check();
  await chooseCombo(page.locator(".compare-select"), "Test catalog");
  await ensureSectionExpanded(page, GLOBALS);
  await page.getByRole("checkbox", { name: "Only show changes" }).check();

  // The difference shows on the global input's own row and on the reader's.
  await expect(slotRow(page, SONG)).toBeVisible();
  await expect(slotRow(page, "gear.ring1")).toBeVisible();
  await expect(slotRow(page, "gear.ring2")).toBeHidden();
  await expect(page.getByTestId("slot-filter-count")).toHaveText(/^\s*2\b/);
});

// One value gets one control or one note per row, however many bonuses on it read the value.
test("a reader's own control on a row replaces the note for a copy reading the same value", async ({
  page,
}) => {
  await openWithReaders(page, {
    "gear.ring1": "test-lute",
    "gear.ring2": "test-duet",
  });
  const ring2 = slotRow(page, "gear.ring2");
  // Ring 2's own reader shows the control, so the copy of Ring 1's reader adds no note.
  await expect(drum(page)).toBeVisible();
  await expect(lute(page)).toBeVisible();
  await expect(ring2.getByTestId(/^bonus-input-note-/)).toHaveCount(0);
});

test("two readers on one item give its row one control and its copy one note", async ({
  page,
}) => {
  await openWithReaders(page, {
    "gear.ring1": "test-duet",
    "gear.ring2": "test-duet",
  });
  const ring1 = slotRow(page, "gear.ring1");
  const ring2 = slotRow(page, "gear.ring2");
  // Both readers anchor on Ring 1, which shows one control, and Ring 2 one note.
  await expect(
    ring1.getByTestId(/^bonus-input-test-(ballad-song|chorus-sang)$/),
  ).toHaveCount(1);
  await expect(ring2.getByTestId(/^bonus-input-note-/)).toHaveCount(1);
  await expect(
    ring2.getByTestId(/^bonus-input-test-(ballad-song|chorus-sang)$/),
  ).toHaveCount(0);
});

// The palette offers a row only while the editor shows it, or there would be nowhere to land.
test("the go-to palette offers the global input and its section only while read", async ({
  page,
}) => {
  await openWithReaders(page, { "gear.ring1": "test-plain" });
  const palette = async () => {
    await page.keyboard.press("ControlOrMeta+k");
    await expect(page.getByTestId("go-to-input")).toBeFocused();
    await expect(page.getByTestId("go-to-option-section:gear")).toBeVisible();
  };
  await palette();
  await expect(page.getByTestId(`go-to-option-section:${GLOBALS}`)).toHaveCount(
    0,
  );
  await page.getByTestId("go-to-input").fill("played a song");
  await expect(page.getByTestId(`go-to-option-slot:${SONG}`)).toHaveCount(0);
  await page.keyboard.press("Escape");

  await chooseItem(page, "gear.ring1", LUTE);
  await palette();
  await expect(
    page.getByTestId(`go-to-option-section:${GLOBALS}`),
  ).toBeVisible();
  await page.getByTestId("go-to-input").fill("played a song");
  await expect(page.getByTestId(`go-to-option-slot:${SONG}`)).toBeVisible();
});

// A boolean's box sits level with its row label like any other control, and the "Used by"
// note goes on its own line below rather than pulling the box down beside it.
test(
  "the checkbox is level with its label, with used by below it",
  { tag: "@cross-browser" },
  async ({ page }) => {
    await openWithReaders(page, { "gear.ring1": "test-lute" });
    await ensureSectionExpanded(page, GLOBALS);
    const row = slotRow(page, SONG);
    const label = (await row.locator(".slot-label").boundingBox())!;
    const box = (await row.getByRole("checkbox").boundingBox())!;
    const usedBy = (await page
      .getByTestId(`slot-used-by:${SONG}`)
      .boundingBox())!;
    const center = (r: { y: number; height: number }) => r.y + r.height / 2;
    expect(Math.abs(center(box) - center(label))).toBeLessThan(2);
    expect(usedBy.y).toBeGreaterThanOrEqual(box.y + box.height);
  },
);
