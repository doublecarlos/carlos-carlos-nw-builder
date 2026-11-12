// A bonus input row that reads a global input: the "Defined by" picker and the summary that
// stands in for the fields a reference does not save.
import { test, expect, type Locator, type Page } from "@playwright/test";
import { openBuilder, pickerMenu } from "./support/app";
import { layerRow, openDrawer } from "./support/nav";
import { importTestCatalog } from "./support/testCatalog";
import { expectNoHorizontalScroll } from "./support/viewport";

const GLOBALS = "test-globals";
const SONG = `${GLOBALS}.song`;
const HIT = `${GLOBALS}.hit`;

const globalSlot = (id: string, label: string, path: string) => ({
  id,
  label,
  section: GLOBALS,
  type: "build_parameter" as const,
  paramType: "boolean" as const,
  path,
  default: false,
  globalInput: true,
});

async function openReader(page: Page): Promise<Locator> {
  await openBuilder(page);
  await importTestCatalog(page, {
    bonuses: [
      {
        id: "test-ballad",
        name: "Test Ballad",
        inputs: { song: { global: SONG } },
        grants: [
          { when: { input: { key: "song", is: true } }, stats: { power: 5 } },
        ],
      },
    ],
    slots: [
      globalSlot(SONG, "Played a song", "test.song"),
      globalSlot(HIT, "Landed a big hit", "test.hit"),
    ],
    sections: [
      { id: GLOBALS, label: "Test Global Inputs", slotIds: [SONG, HIT] },
    ],
  });
  const phone = (page.viewportSize()?.width ?? 0) < 768;
  if (phone) await openDrawer(page);
  await layerRow(page, "Test catalog (imported)").locator(".nav-name").click();
  await page.getByTestId("tab-bonuses").click();
  await page.locator(".editor-search").fill("Test Ballad");
  await page.locator(".editor-row", { hasText: "Test Ballad" }).first().click();
  return page.locator(".bonus-input-row").first();
}

/** A box measured without scrolling, so boxes taken together share one scroll position. */
async function boxOf(target: Locator) {
  const box = await target.boundingBox();
  if (!box) throw new Error("Element is not visible");
  return box;
}

// Global inputs read like bonuses in a picker: the label, with the slot id under it, so two
// similar labels can be told apart and an author can search by id.
test("the global input picker shows each slot's id and finds it by id", async ({
  page,
}) => {
  const row = await openReader(page);
  const picker = row.getByTestId("bonus-input-global");
  const box = picker.getByRole("combobox");
  await expect(box).toHaveValue("Played a song");

  await box.click();
  const menu = pickerMenu(picker);
  const song = menu.getByRole("option", { name: /Played a song/ });
  await expect(song.getByTestId("bonus-option-id")).toHaveText(SONG);

  await box.fill(HIT);
  await expect(menu.getByRole("option")).toHaveCount(1);
  await menu.getByRole("option").click();
  await expect(box).toHaveValue("Landed a big hit");
});

// The summary is a labeled field like its neighbors, so its text sits on the picker's line.
test(
  "the summary sits level with the picker, below its label",
  { tag: "@cross-browser" },
  async ({ page }) => {
    const row = await openReader(page);
    await row.scrollIntoViewIfNeeded();
    const picker = await boxOf(
      row.getByTestId("bonus-input-global").getByRole("combobox"),
    );
    const label = await boxOf(row.getByText("Defined by"));
    const summary = await boxOf(row.getByTestId("bonus-input-global-summary"));

    expect(summary.y).toBeGreaterThanOrEqual(label.y + label.height - 1);
    // Its first line shares the picker's line, even when a narrow pane wraps the text.
    expect(Math.abs(summary.y - picker.y)).toBeLessThan(2);
    // Beside the picker, not on top of it.
    expect(summary.x).toBeGreaterThanOrEqual(picker.x + picker.width);
  },
);

test(
  "on a phone the summary stays inside the row's card",
  { tag: "@cross-browser" },
  async ({ page }) => {
    await page.setViewportSize({ width: 400, height: 800 });
    const row = await openReader(page);
    await row.scrollIntoViewIfNeeded();
    const card = await boxOf(row);
    const summary = await boxOf(row.getByTestId("bonus-input-global-summary"));

    expect(summary.x).toBeGreaterThanOrEqual(card.x);
    expect(summary.x + summary.width).toBeLessThanOrEqual(card.x + card.width);
    await expectNoHorizontalScroll(page);
  },
);
