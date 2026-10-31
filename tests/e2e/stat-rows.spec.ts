// End-to-end coverage for StatRows.vue, the shared "label / value" stat list behind
// the item hover card, the bonus inspector and the stat source card.
import { test, expect } from "@playwright/test";
import { openBuilder, chooseItem } from "./support/app";
import { importTestCatalog } from "./support/testCatalog";

const HEAD_ID = "test-ca-head";
const HEAD_ITEM = "Test CA Head";
const BONUS_ID = "test-ca-head-bonus";

test("the bonus inspector renders a granted stat as a shared row", async ({
  page,
}) => {
  await openBuilder(page);
  await importTestCatalog(page, {
    items: [
      {
        id: HEAD_ID,
        name: HEAD_ITEM,
        filter: "gear_head",
        bonuses: [BONUS_ID],
      },
    ],
    bonuses: [
      {
        id: BONUS_ID,
        name: "Test CA Head Bonus",
        grants: [{ stats: { ca_p: 0.1 } }],
      },
    ],
  });
  await chooseItem(page, "gear.head", HEAD_ITEM);
  await page.getByRole("button", { name: /^Bonuses/ }).click();
  // The active group sorts last, and the equipped item's one bonus grants Combat Advantage.
  await page
    .getByTestId("details-sidebar")
    .locator("button.group")
    .last()
    .click();

  const rows = page.getByTestId("bonus-stat-row");
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText("Combat Advantage");
  await expect(rows.first()).toContainText("+10.00%");
});
