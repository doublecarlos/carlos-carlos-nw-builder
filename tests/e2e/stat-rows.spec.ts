// End-to-end coverage for StatRows.vue, the shared "label / value" stat list behind
// the item hover card, the bonus inspector and the stat source card.
import { test, expect } from "@playwright/test";
import { openBuilder, chooseItem } from "./support/app";

const HEAD_ITEM = "M29 Enchanted Depthweave Cap";

test("the bonus inspector renders a granted stat as a shared row", async ({
  page,
}) => {
  await openBuilder(page);
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
