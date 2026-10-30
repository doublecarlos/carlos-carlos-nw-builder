// A phone shows one pane at a time, so an action that lands in the other pane brings it up:
// a jump to a build row shows the editor, inspecting a bonus shows the stats.
import { test, expect, type Page } from "@playwright/test";
import {
  chooseItem,
  confirmImport,
  cursorRow,
  importText,
  openBuilder,
  slotRow,
} from "../support/app";
import { statCard, statInfoButton } from "../support/stats";

const HEAD_ITEM = "M29 Enchanted Depthweave Cap";
const RING_ID = "test-ramp-ring";
const BONUS_ID = "test-ramp-bonus";

const editorPane = (page: Page) => page.getByTestId("editor-pane");
const statsPane = (page: Page) => page.getByTestId("stat-panel-column");

/** Scrolls the editor to the far end of the list, so landing on a row takes a real scroll. */
async function scrollEditorToEnd(page: Page) {
  await page
    .getByTestId("editor-column")
    .evaluate((el) => el.scrollTo(0, el.scrollHeight));
}

/** Asserts the editor pane is up with the cursor parked on `slotId`'s row, in view. */
async function expectLandedOn(page: Page, slotId: string) {
  await expect(editorPane(page)).toBeVisible();
  await expect(statsPane(page)).toBeHidden();
  await expect(cursorRow(page)).toHaveAttribute(
    "data-cursor-key",
    `slot:${slotId}`,
  );
  await expect(slotRow(page, slotId)).toBeInViewport();
}

test("a stat source on the stats pane jumps back to its editor row", async ({
  page,
}) => {
  await openBuilder(page);
  await chooseItem(page, "gear.head", HEAD_ITEM);
  await scrollEditorToEnd(page);

  await page.getByTestId("pane-stats").click();
  await statInfoButton(page, "strike").click();
  await statCard(page)
    .getByTestId("stat-card-row")
    .filter({ hasText: HEAD_ITEM })
    .click();

  await expect(statCard(page)).toBeHidden();
  await expectLandedOn(page, "gear.head");
});

test("inspecting a bonus from the editor shows the stats pane, and its source jumps back", async ({
  page,
}) => {
  await openBuilder(page);
  await importText(
    page,
    JSON.stringify({
      name: "Inspect test",
      choices: { "gear.ring1": RING_ID },
      catalog: {
        items: {
          [RING_ID]: {
            id: RING_ID,
            name: "Test Ramp Ring",
            filter: "gear_ring",
            bonuses: [BONUS_ID],
          },
        },
        bonuses: {
          [BONUS_ID]: {
            id: BONUS_ID,
            name: "Test Ramp Bonus",
            grants: [
              {
                stats: { power: 100 },
                scale: { formula: "geometric(1, 0.5)" },
              },
            ],
          },
        },
        sectionPresets: {},
      },
    }),
  );
  await confirmImport(page);

  await slotRow(page, "gear.ring1").scrollIntoViewIfNeeded();
  await page.getByTestId("slot-info:gear.ring1").click();
  await scrollEditorToEnd(page);
  await page
    .getByTestId("item-card-sheet")
    .getByTestId("item-card-inspect")
    .click();

  await expect(editorPane(page)).toBeHidden();
  await expect(page.getByTestId("pane-stats")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  const entry = page.getByTestId(`bonus-entry-${BONUS_ID}`);
  await expect(entry).toBeInViewport();

  await entry.getByTestId("bonus-source-link").first().click();
  await expectLandedOn(page, "gear.ring1");
});
