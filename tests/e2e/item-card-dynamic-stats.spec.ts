// The hover card's treatment of typed stats: an item's own dynamicStats config is a stat row
// at the value the engine resolved for the slot, and a grant's typed stat reads the same way,
// each noting the range the player can type within.
import { test, expect, type Page } from "@playwright/test";
import {
  confirmImport,
  hoverForCard,
  importText,
  openBuilder,
  slotRow,
} from "./support/app";

const RING_SLOT = "gear.ring1";
const RING_ID = "test-dynamic-card-ring";
const BONUS_ID = "test-dynamic-card-bonus";

/** A ring typing its own Power, carrying a bonus that types Defense on top of a fixed 10. */
async function importRing(page: Page) {
  await importText(
    page,
    JSON.stringify({
      name: "Dynamic card test",
      choices: { [RING_SLOT]: RING_ID },
      catalog: {
        items: {
          [RING_ID]: {
            id: RING_ID,
            name: "Test Dynamic Card Ring",
            filter: "gear_ring",
            dynamicStats: [
              {
                stat: "power",
                min: 0,
                max: 1000,
                default: 500,
                label: "Enchant rank",
              },
            ],
            bonuses: [BONUS_ID],
          },
        },
        bonuses: {
          [BONUS_ID]: {
            id: BONUS_ID,
            name: "Test Dynamic Card Bonus",
            grants: [
              {
                stats: { defense: 10 },
                dynamicStats: [
                  { stat: "defense", min: 0, max: 200, default: 40 },
                ],
              },
            ],
          },
        },
        sectionPresets: {},
      },
    }),
  );
  await confirmImport(page);
  await expect(page.getByTestId("app-header")).toContainText(/imported/i);
}

const card = (page: Page) => page.getByTestId("item-card");

/** The card's row for one stat. Only the ring's own rows mention Power, so a label picks
 *  the row out without scoping past the bonus list. */
const ownRow = (page: Page, label: string) =>
  card(page).getByTestId("stat-row").filter({ hasText: label });

test("an item's typed stat is a stat row at its default, noting the range", async ({
  page,
}) => {
  await openBuilder(page);
  await importRing(page);

  await hoverForCard(page, slotRow(page, RING_SLOT).locator(".slot-label"));
  await expect(card(page)).toBeVisible();

  const power = ownRow(page, "Power");
  await expect(power).toContainText("+500");
  await expect(power.getByTestId("stat-row-note")).toHaveText(
    "Enchant rank, from 0 to 1,000",
  );
  // No longer a muted note: the range sits under the row, not in the notes block.
  await expect(card(page)).not.toContainText("Enchant rank 0 to 1,000");
});

test("the row follows the value typed on the slot", async ({ page }) => {
  await openBuilder(page);
  await importRing(page);

  const input = slotRow(page, RING_SLOT).getByTestId("slot-dynamic:power");
  await input.fill("750");
  await input.blur();

  await hoverForCard(page, slotRow(page, RING_SLOT).locator(".slot-label"));
  await expect(card(page)).toBeVisible();
  await expect(ownRow(page, "Power")).toContainText("+750");
});

test("a grant's typed stat merges with its fixed share and notes the same range", async ({
  page,
}) => {
  await openBuilder(page);
  await importRing(page);

  await hoverForCard(page, slotRow(page, RING_SLOT).locator(".slot-label"));
  await expect(card(page)).toBeVisible();

  const grantRow = card(page)
    .getByTestId("item-card-grant")
    .getByTestId("stat-row")
    .filter({ hasText: "Defense" });
  await expect(grantRow).toContainText("+50");
  await expect(grantRow.getByTestId("stat-row-note")).toHaveText(
    "from 0 to 200",
  );
});
