// End-to-end coverage for issue #94: a bonus set that only ever reports a build error/warning
// (`Grant.problem`, never stats) must not show up as a "bonus" in the item hover card
// (ItemCard.vue) or the sidebar's Bonuses table (BonusInspector.vue) -- it already gets its
// own inline message on the slot and its own line in the errors summary, so listing it again
// as an inactive/active-looking bonus that grants nothing is just confusing.
//
// Uses the shipped "Tier 2 Boon Warning" bonus (data/db-bonuses.json's "boon-tier2-warning"),
// carried by every boons.tier2 item (data/db-items.json), which fires whenever any tier 2
// points are spent with fewer than 10 points spent on tier 1+ boons -- true by default, since
// a fresh build has 0 points spent anywhere.
import { test, expect } from "@playwright/test";
import {
  openBuilder,
  slotRow,
  assignmentLabel,
  stepAssignment,
} from "./support/app";

const SLOT_ID = "boons.tier2";
const SEVERITY_ID = "boon-tier2-severity";
const WARNING_MESSAGE =
  "Tier 2 boons need at least 10 points spent on previous boons.";
const WARNING_TITLE = "Tier 2 Boon Warning";

test("a problem-only bonus is hidden from the item hover card and the sidebar Bonuses table", async ({
  page,
}) => {
  await openBuilder(page);
  const row = slotRow(page, SLOT_ID);
  await row.scrollIntoViewIfNeeded();

  await stepAssignment(row, SEVERITY_ID, "increase");

  // The warning itself still fires, inline on the row.
  await expect(row.getByText(WARNING_MESSAGE)).toBeVisible();

  // The item's hover card shows the item, but no "Bonuses" section at all -- the warning bonus
  // is Critical Severity's only bonus, and it is hidden.
  await assignmentLabel(row, SEVERITY_ID).hover();
  const card = page.locator(".fixed.z-40");
  await expect(card.getByTestId("item-card-name")).toHaveText(
    "Critical Severity",
  );
  await expect(card.getByText(WARNING_TITLE)).toHaveCount(0);
  await expect(card.getByText("Bonuses", { exact: true })).toHaveCount(0);

  await page.mouse.move(0, 0);
  await expect(card).toBeHidden();

  // The sidebar's Bonuses tab agrees: filtering for the warning's own title finds nothing.
  await page.getByRole("button", { name: /^Bonuses/ }).click();
  await page
    .getByPlaceholder("Filter by bonus, set or item…")
    .fill(WARNING_TITLE);
  await expect(page.getByText("Nothing matches that filter.")).toBeVisible();
});
