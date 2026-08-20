// Getting from "you are 1 away" to "here is where you would get it" -- the thing the Bonuses
// tab's badge raised and could not answer.
import { test, expect } from "@playwright/test";
import { openBuilder, slotFilterInput } from "./support/app";

/** The shipped near-miss pair: "Death's Bulwark Stats" needs one occurrence of the proc, and
 *  the only row that can supply it is the master boons slot. */
const BONUS_ID = "death-s-bulwark-stats";
const SUPPLYING_SLOT = "boons.tier_master";

async function openBonuses(page: import("@playwright/test").Page) {
  await openBuilder(page);
  await page.getByRole("button", { name: /Bonuses/ }).click();
}

const locate = (page: import("@playwright/test").Page) =>
  page.getByTestId(`bonus-locate-${BONUS_ID}`);

const slotRows = (page: import("@playwright/test").Page) =>
  page.locator('[data-cursor-key^="slot:"]');

test("locating a near miss narrows the slot list to what could supply it", async ({
  page,
}) => {
  await openBonuses(page);

  await locate(page).click();

  await expect(slotRows(page)).toHaveCount(1);
  await expect(
    page.locator(`[data-cursor-key="slot:${SUPPLYING_SLOT}"]`),
  ).toBeVisible();
});

test("the section holding a match is forced open", async ({ page }) => {
  await openBonuses(page);
  // Collapsed by hand first: without the force-open, a match inside a shut section would
  // never show -- the same rule the text and stat filters already follow.
  await page.getByRole("button", { name: "collapse all" }).click();
  await expect(
    page.locator(`[data-cursor-key="slot:${SUPPLYING_SLOT}"]`),
  ).toBeHidden();

  await locate(page).click();

  await expect(
    page.locator(`[data-cursor-key="slot:${SUPPLYING_SLOT}"]`),
  ).toBeVisible();
});

test("the active filter says which bonus it is for", async ({ page }) => {
  await openBonuses(page);

  await locate(page).click();

  await expect(page.getByTestId("slot-filter-bonus")).toContainText(
    "Death's Bulwark Stats",
  );
  await expect(page.getByTestId("slot-filter-count")).toContainText("1 match");
});

test("the chip's own control drops just the bonus filter", async ({ page }) => {
  await openBonuses(page);
  await locate(page).click();
  // A narrowing the user set themselves, which dropping the bonus filter must not discard.
  await slotFilterInput(page).fill("boons");

  await page.getByTestId("slot-filter-bonus-clear").click();

  await expect(page.getByTestId("slot-filter-bonus")).toBeHidden();
  await expect(slotFilterInput(page)).toHaveValue("boons");
});

test("clear filters drops it along with everything else", async ({ page }) => {
  await openBonuses(page);
  await locate(page).click();
  await expect(page.getByTestId("slot-filter-bonus")).toBeVisible();

  await page.getByTestId("slot-filter-clear").click();

  await expect(page.getByTestId("slot-filter-bonus")).toBeHidden();
  await expect(slotRows(page)).not.toHaveCount(1);
});

test("a slot whose current choice already contributes is still listed", async ({
  page,
}) => {
  await openBonuses(page);
  await locate(page).click();
  const row = page.locator(`[data-cursor-key="slot:${SUPPLYING_SLOT}"]`);
  await expect(row).toBeVisible();

  // Spending a point there is what satisfies the near miss; the row that got you there has to
  // stay on screen, or the filter would empty itself out from under the user mid-fix.
  await row
    .getByTestId("assignment-input-boon-master-death-s-bulwark")
    .fill("1");

  await expect(row).toBeVisible();
});
