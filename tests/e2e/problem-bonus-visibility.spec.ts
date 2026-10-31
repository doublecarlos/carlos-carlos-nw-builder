// End-to-end coverage for problem-only bonuses: one that only ever reports a build
// error/warning (`Grant.problem`, never stats) must not show up as a "bonus" in the item hover card
// (ItemCard.vue) or the sidebar's Bonuses table (BonusInspector.vue) -- it already gets its
// own inline message on the slot and its own line in the errors summary, so listing it again
// as an inactive/active-looking bonus that grants nothing is just confusing.
//
// Drives a test boon in the Tier 2 point_assignment row whose only bonus is an unconditional
// warning, so it fires the moment a point is spent.
import { test, expect } from "@playwright/test";
import {
  openBuilder,
  slotRow,
  assignmentLabel,
  stepAssignment,
} from "./support/app";
import { importTestCatalog } from "./support/testCatalog";

const SLOT_ID = "boons.tier2";
const BOON_ID = "test-problem-boon";
const BOON_NAME = "Test Problem Boon";
const WARNING_ID = "test-problem-warning";
const WARNING_MESSAGE = "Test problem warning message.";
const WARNING_TITLE = "Test Problem Warning";

test("a problem-only bonus is hidden from the item hover card and the sidebar Bonuses table", async ({
  page,
}) => {
  await openBuilder(page);
  await importTestCatalog(page, {
    items: [
      {
        id: BOON_ID,
        name: BOON_NAME,
        filter: "boon_tier2",
        bonuses: [WARNING_ID],
        inlineRepetition: { min: 0, max: 5, default: 0 },
      },
    ],
    bonuses: [
      {
        id: WARNING_ID,
        name: WARNING_TITLE,
        grants: [
          {
            problem: {
              severity: "warning",
              message: WARNING_MESSAGE,
              label: "Boons",
            },
          },
        ],
      },
    ],
  });
  const row = slotRow(page, SLOT_ID);
  await row.scrollIntoViewIfNeeded();

  await stepAssignment(row, BOON_ID, "increase");

  // The warning itself still fires, inline on the row.
  await expect(row.getByText(WARNING_MESSAGE)).toBeVisible();

  // The item's hover card shows the item, but no "Bonuses" section at all -- the warning bonus
  // is this item's only bonus, and it is hidden. Scroll the label into place first: the card
  // cancels a pending open on any scroll, so a hover that still has to scroll would cancel
  // itself.
  await assignmentLabel(row, BOON_ID).scrollIntoViewIfNeeded();
  await assignmentLabel(row, BOON_ID).hover();
  const card = page.getByTestId("item-card");
  await expect(card.getByTestId("item-card-name")).toHaveText(BOON_NAME);
  await expect(card.getByText(WARNING_TITLE)).toHaveCount(0);
  await expect(card.getByText("Bonuses", { exact: true })).toHaveCount(0);

  await page.mouse.move(0, 0);
  await expect(card).toBeHidden();

  // The sidebar's Bonuses tab agrees: filtering for the warning's own title finds nothing.
  await page.getByRole("button", { name: /^Bonuses/ }).click();
  await page
    .getByPlaceholder("Filter by bonus, id or item…")
    .fill(WARNING_TITLE);
  await expect(page.getByText("Nothing matches the filter.")).toBeVisible();
});
