// End-to-end coverage for StatPanel.vue's stat source popover (StatSourceCard.vue): which
// items/bonuses/pipeline stages fed a given stat's number, one stat at a time.
import { test, expect } from "@playwright/test";
import { openBuilder, chooseItem } from "./support/app";
import {
  statInfoButton,
  statCard,
  statCardClose,
  statCardSourceGroups,
} from "./support/stats";

// Same item slot-list.spec.ts already relies on: unique across the item table and class-
// restricted to warlock, so equipping it also exercises the allowed-class error path. It
// grants `strike`/`forte`/`combined_rating` directly (an item-stat trio, not by a bonus)
// and carries an active bonus of its own granting Combat Advantage -- useful precisely
// because its Rating/Percentage sources come from two different mechanisms.
const HEAD_ITEM = "M29 Enchanted Depthweave Cap";

test.describe("stat source popover", () => {
  test('clicking a rating stat\'s button opens its card, led by an empty Rating section and a Percentage section led by "Rating contribution"', async ({
    page,
  }) => {
    await openBuilder(page);

    await statInfoButton(page, "power").click();
    const card = statCard(page);
    await expect(card).toBeVisible();
    await expect(card.locator('[data-testid="stat-card-title"]')).toHaveText(
      "Power",
    );

    // No items/bonuses at all yet, so Rating has nothing to show.
    await expect(card.locator('[data-testid="stat-card-empty"]')).toHaveText(
      "no contributing sources",
    );

    // Percentage still has the rating->percent conversion itself. The forte slots now
    // default to empty, so no "Forte" source row exists on a fresh build.
    const groups = statCardSourceGroups(page);
    await expect(groups).toHaveCount(1);
    const percentRows = groups.nth(0).locator('[data-testid="stat-card-row"]');
    await expect(percentRows).toHaveCount(1);
    await expect(percentRows.nth(0)).toContainText("Rating contribution");
  });

  test("equipping an item adds it as a Rating source alongside Combined rating", async ({
    page,
  }) => {
    await openBuilder(page);
    await chooseItem(page, "gear.head", HEAD_ITEM);

    // The item's own `strike` stat plus the flat `combined_rating` every item/bonus feeds --
    // Critical Strike is the rating stat this item happens to grant directly.
    await statInfoButton(page, "strike").click();
    const card = statCard(page);
    await expect(card).toBeVisible();
    await expect(card.locator('[data-testid="stat-card-title"]')).toHaveText(
      "Critical Strike",
    );

    const groups = statCardSourceGroups(page);
    await expect(groups).toHaveCount(2);

    const ratingRows = groups.nth(0).locator('[data-testid="stat-card-row"]');
    await expect(ratingRows).toHaveCount(2);
    await expect(ratingRows.nth(0)).toContainText(HEAD_ITEM);
    await expect(ratingRows.nth(0)).toContainText("+");
    await expect(ratingRows.nth(1)).toContainText("Combined rating");

    // strike_p has no ability contribution -- only Rating contribution feeds it, since
    // the forte slots default to empty on a fresh build.
    const percentRows = groups.nth(1).locator('[data-testid="stat-card-row"]');
    await expect(percentRows).toHaveCount(1);
    await expect(percentRows.nth(0)).toContainText("Rating contribution");
  });

  test("a bonus contributes to the stat it grants, distinct from the item that carries it", async ({
    page,
  }) => {
    await openBuilder(page);
    await chooseItem(page, "gear.head", HEAD_ITEM);

    // HEAD_ITEM's own active bonus grants Combat Advantage -- the item itself carries no `ca`
    // or `ca_p` stat, so this line can only have come from the bonus, not the item's own stats.
    // Combined rating (every rating stat's own line) fills the Rating section, so the bonus's
    // contribution lands in the Percentage one.
    await statInfoButton(page, "ca").click();
    const percentRows = statCardSourceGroups(page)
      .nth(1)
      .locator('[data-testid="stat-card-row"]');
    await expect(percentRows.filter({ hasText: HEAD_ITEM })).toHaveCount(1);
  });

  test("an unpaired stat gets a single, title-less section", async ({
    page,
  }) => {
    await openBuilder(page);
    await chooseItem(page, "gear.head", HEAD_ITEM);

    // Combined Rating has no percentage counterpart of its own -- it's the thing that feeds
    // every *other* rating stat's own Rating section, not part of a pair itself.
    await statInfoButton(page, "combined_rating").click();
    const card = statCard(page);
    await expect(card.locator('[data-testid="stat-card-section"]')).toHaveCount(
      0,
    );
    const rows = card.locator('[data-testid="stat-card-row"]');
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText(HEAD_ITEM);
  });

  test("clicking the same button again closes the card", async ({ page }) => {
    await openBuilder(page);
    const button = statInfoButton(page, "power");

    await button.click();
    await expect(statCard(page)).toBeVisible();

    await button.click();
    await expect(statCard(page)).toBeHidden();
  });

  test("clicking a different stat's button switches the card straight over", async ({
    page,
  }) => {
    await openBuilder(page);
    await statInfoButton(page, "power").click();
    await expect(
      statCard(page).locator('[data-testid="stat-card-title"]'),
    ).toHaveText("Power");

    await statInfoButton(page, "acc").click();
    await expect(statCard(page)).toHaveCount(1);
    await expect(
      statCard(page).locator('[data-testid="stat-card-title"]'),
    ).toHaveText("Accuracy");
  });

  test("the close button closes the card", async ({ page }) => {
    await openBuilder(page);
    await statInfoButton(page, "power").click();
    await expect(statCard(page)).toBeVisible();

    await statCardClose(page).click();
    await expect(statCard(page)).toBeHidden();
  });

  test("clicking outside the card closes it", async ({ page }) => {
    await openBuilder(page);
    await statInfoButton(page, "power").click();
    await expect(statCard(page)).toBeVisible();

    await page.locator("h1").click();
    await expect(statCard(page)).toBeHidden();
  });

  test("scrolling with the pointer over the card does not scroll the sidebar underneath it", async ({
    page,
  }) => {
    await openBuilder(page);
    const sidebar = page.locator(".sidebar");
    await expect(sidebar).toHaveJSProperty("scrollTop", 0);

    await statInfoButton(page, "power").click();
    await statCard(page).hover();

    await page.mouse.wheel(0, 400);
    await expect(sidebar).toHaveJSProperty("scrollTop", 0);
  });
});
