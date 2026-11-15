// A bonus input row that reads a shared input: the "Defined by" picker and the summary that
// stands in for the fields a reference does not save.
import { test, expect, type Locator, type Page } from "@playwright/test";
import { openBuilder, pickerMenu } from "./support/app";
import { layerRow, openDrawer } from "./support/nav";
import { importTestCatalog } from "./support/testCatalog";
import { expectNoHorizontalScroll } from "./support/viewport";

const SHARED = "test-shared";
const SONG = `${SHARED}.song`;
const HIT = `${SHARED}.hit`;

const sharedSlot = (id: string, label: string, path: string) => ({
  id,
  label,
  section: SHARED,
  type: "build_parameter" as const,
  paramType: "boolean" as const,
  path,
  default: false,
  sharedInput: true,
});

async function openReader(page: Page, reads = SONG): Promise<Locator> {
  await openBuilder(page);
  await importTestCatalog(page, {
    bonuses: [
      {
        id: "test-ballad",
        name: "Test Ballad",
        inputs: { song: { shared: reads } },
        grants: [
          { when: { input: { key: "song", is: true } }, stats: { power: 5 } },
        ],
      },
    ],
    slots: [
      sharedSlot(SONG, "Played a song", "test.song"),
      sharedSlot(HIT, "Landed a big hit", "test.hit"),
    ],
    sections: [
      { id: SHARED, label: "Test Shared Inputs", slotIds: [SONG, HIT] },
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

// Shared inputs read like bonuses in a picker: the label, with the slot id under it, so two
// similar labels can be told apart and an author can search by id.
test("the shared input picker shows each slot's id and finds it by id", async ({
  page,
}) => {
  const row = await openReader(page);
  const picker = row.getByTestId("bonus-input-shared");
  const box = picker.getByRole("combobox");
  await expect(box).toHaveValue("Played a song");

  await box.click();
  const menu = pickerMenu(picker);
  const song = menu.getByRole("option", { name: /Played a song/ });
  await expect(song.getByTestId("option-row-id")).toHaveText(SONG);

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
      row.getByTestId("bonus-input-shared").getByRole("combobox"),
    );
    const label = await boxOf(row.getByText("Defined by"));
    const summary = await boxOf(row.getByTestId("bonus-input-shared-summary"));

    expect(summary.y).toBeGreaterThanOrEqual(label.y + label.height - 1);
    // On desktop the summary shares the picker's line, its first line level with the box.
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
    const summary = await boxOf(row.getByTestId("bonus-input-shared-summary"));

    expect(summary.x).toBeGreaterThanOrEqual(card.x);
    expect(summary.x + summary.width).toBeLessThanOrEqual(card.x + card.width);
    await expectNoHorizontalScroll(page);
  },
);

// A reference to a shared input that no longer exists still names it, beside the summary
// saying so, so the author can see what to fix.
test("a reference to a missing shared input shows its id", async ({ page }) => {
  const row = await openReader(page, "test-shared.gone");
  await expect(
    row.getByTestId("bonus-input-shared").getByRole("combobox"),
  ).toHaveValue("test-shared.gone");
  await expect(row.getByTestId("bonus-input-shared-summary")).toContainText(
    "is not a shared input",
  );
});
