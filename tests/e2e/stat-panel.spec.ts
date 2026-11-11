// End-to-end coverage for StatPanel.vue's stat source popover (StatPanelSourceCard.vue): which
// items/bonuses/pipeline stages fed a given stat's number, one stat at a time.
import { test, expect, type Page } from "@playwright/test";
import { openBuilder, chooseItem, cursorRow, slotRow } from "./support/app";
import {
  statInfoButton,
  statCard,
  statCardClose,
  statCardPin,
  statCardSourceGroups,
  chooseSummaryCase,
} from "./support/stats";
import { importTestCatalog } from "./support/testCatalog";

// Grants `strike` and `combined_rating` directly and carries an active bonus granting Combat
// Advantage, so its Rating and Percentage sources come from two different mechanisms. Class-
// restricted, so equipping it with no class chosen is a problem.
const HEAD_ITEM = "Test Stat Head";
const HEAD_BONUS = "Test Stat Head Bonus";
const GUARD_ENCHANT = "Test Guard Enchant";

/** Imports the head and guard enchant this file equips. */
async function importStatItems(page: Page) {
  await importTestCatalog(page, {
    items: [
      {
        id: "test-stat-head",
        name: HEAD_ITEM,
        filter: "gear_head",
        allowedClass: ["warlock"],
        strike: 1000,
        combined_rating: 1000,
        bonuses: ["test-stat-head-bonus"],
      },
      {
        id: "test-guard-enchant",
        name: GUARD_ENCHANT,
        filter: "combat_enchant_defense",
        hit_points_mult: 0.1,
      },
    ],
    bonuses: [
      {
        id: "test-stat-head-bonus",
        name: HEAD_BONUS,
        grants: [{ stats: { ca_p: 0.1 } }],
      },
    ],
  });
}

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
    await importStatItems(page);
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
    await importStatItems(page);
    await chooseItem(page, "gear.head", HEAD_ITEM);

    // HEAD_ITEM carries no `ca` or `ca_p` stat of its own, so this line can only come from
    // its bonus.
    // Combined rating (every rating stat's own line) fills the Rating section, so the bonus's
    // contribution lands in the Percentage one.
    await statInfoButton(page, "ca").click();
    const percentRows = statCardSourceGroups(page)
      .nth(1)
      .locator('[data-testid="stat-card-row"]');
    await expect(percentRows.filter({ hasText: HEAD_BONUS })).toHaveCount(1);
  });

  test("an unpaired stat gets a single, title-less section", async ({
    page,
  }) => {
    await openBuilder(page);
    await importStatItems(page);
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
    await expect(card.getByTestId("stat-card-multiplicative")).toHaveCount(0);
  });

  test("a multiplicative stat's card says its rows multiply", async ({
    page,
  }) => {
    await openBuilder(page);
    await importStatItems(page);
    await chooseItem(page, "enchantments.combatDefense", GUARD_ENCHANT);

    await statInfoButton(page, "hit_points_mult").click();
    const card = statCard(page);
    await expect(
      card
        .locator('[data-testid="stat-card-row"]')
        .filter({ hasText: GUARD_ENCHANT }),
    ).toHaveCount(1);
    await expect(card.getByTestId("stat-card-multiplicative")).toBeVisible();
  });

  test("clicking an item's row jumps to its build row, leaving a pinned card open", async ({
    page,
  }) => {
    await openBuilder(page);
    await importStatItems(page);
    await chooseItem(page, "gear.head", HEAD_ITEM);
    // From the far end of the list, so landing in view takes a real scroll.
    await page
      .getByTestId("editor-column")
      .evaluate((el) => el.scrollTo(0, el.scrollHeight));
    await expect(slotRow(page, "gear.head")).not.toBeInViewport();

    await statInfoButton(page, "strike").click();
    await statCard(page)
      .locator('[data-testid="stat-card-row"]')
      .filter({ hasText: HEAD_ITEM })
      .click();

    await expect(statCard(page)).toBeVisible();
    await expect(cursorRow(page)).toHaveAttribute(
      "data-cursor-key",
      "slot:gear.head",
    );
    await expect(slotRow(page, "gear.head")).toBeInViewport();
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

  test("hovering a stat's button previews its card, which closes when the pointer leaves", async ({
    page,
  }) => {
    await openBuilder(page);
    await statInfoButton(page, "power").hover();
    await expect(
      statCard(page).locator('[data-testid="stat-card-title"]'),
    ).toHaveText("Power");
    await expect(statCardPin(page)).toBeVisible();

    await page.getByTestId("app-header").hover();
    await expect(statCard(page)).toBeHidden();
  });

  test("a previewed card's pin button keeps it open after the pointer leaves", async ({
    page,
  }) => {
    await openBuilder(page);
    await statInfoButton(page, "power").hover();
    await statCardPin(page).click();
    await expect(statCardClose(page)).toBeVisible();

    await page.getByTestId("app-header").hover();
    await expect(statCard(page)).toBeVisible();
  });

  test("the card opens beside the panel, clear of the stat buttons", async ({
    page,
  }) => {
    // The pointer's way from a button to its card must not cross other rows' buttons.
    await openBuilder(page);
    await statInfoButton(page, "power").hover();
    const cardBox = await statCard(page).boundingBox();
    const buttonBox = await statInfoButton(page, "power").boundingBox();
    expect(cardBox!.x + cardBox!.width).toBeLessThan(buttonBox!.x);
  });

  test("the close button closes the card", async ({ page }) => {
    await openBuilder(page);
    await statInfoButton(page, "power").click();
    await expect(statCard(page)).toBeVisible();

    await statCardClose(page).click();
    await expect(statCard(page)).toBeHidden();
  });

  test("a pinned card outlasts a click elsewhere and closes on Escape", async ({
    page,
  }) => {
    // Pinned means it stays until the reader dismisses it on purpose.
    await openBuilder(page);
    await statInfoButton(page, "power").click();
    await expect(statCard(page)).toBeVisible();

    await page.locator("h1").click();
    await expect(statCard(page)).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(statCard(page)).toBeHidden();
  });

  test("clicking inside the card keeps it open", async ({ page }) => {
    // Outside-click detection must treat the card's own panel as inside.
    await openBuilder(page);
    await statInfoButton(page, "power").click();
    await statCard(page).locator('[data-testid="stat-card-title"]').click();
    await expect(statCard(page)).toBeVisible();
  });

  test("scrolling with the pointer over the card does not scroll the sidebar underneath it", async ({
    page,
  }) => {
    await openBuilder(page);
    const sidebar = page.getByTestId("details-sidebar");
    await expect(sidebar).toHaveJSProperty("scrollTop", 0);

    await statInfoButton(page, "power").click();
    await statCard(page).hover();

    await page.mouse.wheel(0, 400);
    await expect(sidebar).toHaveJSProperty("scrollTop", 0);
  });
});

test.describe("problem list", () => {
  test("a problem's label jumps to the slot it is about", async ({ page }) => {
    await openBuilder(page);
    await importStatItems(page);
    // Class-restricted with no class chosen, so equipping it is itself the problem.
    await chooseItem(page, "gear.head", HEAD_ITEM);
    const link = page.getByTestId("stat-panel-error-link");
    await expect(link).toHaveText("Head");

    // From the far end of the list, so landing in view takes a real scroll.
    await page
      .getByTestId("editor-column")
      .evaluate((el) => el.scrollTo(0, el.scrollHeight));
    await expect(slotRow(page, "gear.head")).not.toBeInViewport();

    await link.click();

    await expect(cursorRow(page)).toHaveAttribute(
      "data-cursor-key",
      "slot:gear.head",
    );
    await expect(slotRow(page, "gear.head")).toBeInViewport();
  });
});

// EHP reads the enemy's crit against the player's deflect, the same four cases damage offers,
// and each one can lead the summary.
test.describe("effective hit points", () => {
  test("lists every crit and deflect case, and the summary can show each", async ({
    page,
  }) => {
    await openBuilder(page);

    const ehpRows = page.locator('[data-stat-table="ehp"] [data-stat-row]');
    await expect(ehpRows).toHaveText(
      [
        "Average",
        "Crit / no deflect",
        "Crit / deflect",
        "No crit / no deflect",
        "No crit / deflect",
      ].map((label) => new RegExp(`^${label}`)),
    );

    const row = page.locator(
      '[data-stat-table="ehp"] [data-stat-row="noCritDeflect"] [data-testid="stat-value"]',
    );
    const summary = page.locator('[data-summary-row="ehp"]');
    await chooseSummaryCase(page, "ehp", "No crit / deflect");
    await expect(summary.getByTestId("summary-value")).toHaveText(
      (await row.textContent())!.trim(),
    );
  });
});

test("rating labels stay on one line at the panel's default width", async ({
  page,
}) => {
  // The default rail width is chosen so the longest label never wraps beside real numbers.
  await openBuilder(page);
  await importStatItems(page);
  await chooseItem(page, "gear.head", HEAD_ITEM);
  const labels = page.locator('tr[data-stat-row] [data-testid="stat-label"]');
  // Rows of a section that is not on screen measure zero and say nothing about wrapping.
  const heights = await labels.evaluateAll((spans) =>
    spans
      .map((span) => span.getBoundingClientRect().height)
      .filter((height) => height > 0),
  );
  expect(heights.length).toBeGreaterThan(0);
  expect(new Set(heights).size).toBe(1);
});
