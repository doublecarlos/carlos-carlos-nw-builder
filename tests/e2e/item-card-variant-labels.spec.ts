// A grant that varies by condition keeps each variant's own label on the hover card even while
// the grant's gate is unmet, so the rungs never all read as "always on".
import { test, expect, type Page } from "@playwright/test";
import {
  confirmImport,
  hoverForCard,
  importText,
  openBuilder,
  slotRow,
} from "./support/app";

const RING_SLOT = "gear.ring1";
const RING_ID = "test-variant-label-ring";
const BONUS_ID = "test-variant-label-bonus";

/** A ring whose bonus needs the Wildspace location before its role variants apply. */
async function importRing(page: Page) {
  await importText(
    page,
    JSON.stringify({
      name: "Variant label test",
      choices: { [RING_SLOT]: RING_ID },
      catalog: {
        items: {
          [RING_ID]: {
            id: RING_ID,
            name: "Test Variant Label Ring",
            filter: "gear_ring",
            bonuses: [BONUS_ID],
          },
        },
        bonuses: {
          [BONUS_ID]: {
            id: BONUS_ID,
            name: "Test Variant Label Bonus",
            grants: [
              {
                when: { equipped: { item: "location-wildspace" } },
                variants: [
                  { when: { role: "dps" }, stats: { power: 100 } },
                  { when: { role: "tank" }, stats: { defense: 100 } },
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

test("variant rungs keep their own condition labels under an unmet grant gate", async ({
  page,
}) => {
  await openBuilder(page);
  await importRing(page);

  await hoverForCard(page, slotRow(page, RING_SLOT).locator(".slot-label"));
  const grant = page.getByTestId("item-card-grant");
  await expect(grant).toBeVisible();
  await expect(grant.getByTestId("item-card-bonus-unmet")).toContainText(
    "needs 1× Location: Wildspace",
  );

  await expect(grant).toContainText("Role: dps:");
  await expect(grant).toContainText("Role: tank:");
  await expect(grant).not.toContainText("always on");
});
