// Folding a bonus's grants: by the chevron or the header row, the summary a folded grant
// shows, and the grants heading's expand/collapse all pair.
import { test, expect, type Page } from "@playwright/test";
import { openBuilder } from "./support/app";
import { addLayer, layerRow } from "./support/nav";

async function openNewBonus(page: Page) {
  await openBuilder(page);
  await addLayer(page);
  await layerRow(page, "Layer 1").locator(".nav-name").click();
  await page.getByRole("button", { name: /Bonuses \d+/ }).click();
  await page.getByTestId("new-bonus").click();
}

test("a grant folds to a summary from its chevron or header row", async ({
  page,
}) => {
  await openNewBonus(page);
  await page.getByLabel("Add grant").click();

  const grant = page.getByTestId("bonus-grant-row").first();
  await expect(grant).toHaveAttribute("data-expanded", "true");
  await expect(grant.getByText("Always active.")).toBeVisible();

  await grant.getByTestId("grant-toggle").click();
  await expect(grant).toHaveAttribute("data-expanded", "false");
  await expect(grant.getByTestId("grant-summary")).toHaveText("0 stats");
  await expect(grant.getByText("Active when")).toBeHidden();

  // The header's inert area folds too; its actions do not.
  await grant.getByText("Grant 1").click();
  await expect(grant).toHaveAttribute("data-expanded", "true");
  await grant.getByLabel("Duplicate grant").click();
  await expect(grant).toHaveAttribute("data-expanded", "true");
  await expect(page.getByTestId("bonus-grant-row")).toHaveCount(2);
});

test("expand and collapse all fold every grant together", async ({ page }) => {
  await openNewBonus(page);
  await expect(page.getByTestId("grant-expand-all")).toHaveCount(0);
  await page.getByLabel("Add grant").click();
  await page.getByLabel("Add grant").click();

  const grants = page.getByTestId("bonus-grant-row");
  const expandAll = page.getByTestId("grant-expand-all");
  const collapseAll = page.getByTestId("grant-collapse-all");
  await expect(expandAll).toBeDisabled();

  await collapseAll.click();
  await expect(grants.nth(0)).toHaveAttribute("data-expanded", "false");
  await expect(grants.nth(1)).toHaveAttribute("data-expanded", "false");
  await expect(collapseAll).toBeDisabled();

  // A new grant lands open among folded ones.
  await page.getByLabel("Add grant").click();
  await expect(grants.nth(2)).toHaveAttribute("data-expanded", "true");

  await expandAll.click();
  await expect(grants.nth(0)).toHaveAttribute("data-expanded", "true");
  await expect(grants.nth(1)).toHaveAttribute("data-expanded", "true");
});

test("tiers keep their add row after the list, with an empty note when there are none", async ({
  page,
}) => {
  await openNewBonus(page);
  await page.getByLabel("Add grant").click();
  const grant = page.getByTestId("bonus-grant-row").first();
  await grant.getByRole("button", { name: "tiered" }).click();

  // Switching to tiered starts with one tier; the add row stays after it.
  await expect(grant.getByTestId("bonus-tier-row")).toHaveCount(1);
  await expect(grant.getByText("No tiers.")).toBeHidden();
  await grant.getByTestId("add-tier").click();
  await expect(grant.getByTestId("bonus-tier-row")).toHaveCount(2);
  await grant
    .getByTestId("bonus-tier-row")
    .nth(0)
    .getByLabel("Remove tier")
    .click();
  await grant
    .getByTestId("bonus-tier-row")
    .nth(0)
    .getByLabel("Remove tier")
    .click();
  await expect(grant.getByText("No tiers.")).toBeVisible();
  await grant.getByTestId("add-tier").click();
  await grant.getByTestId("add-tier").click();
  await expect(
    grant.getByTestId("bonus-tier-row").nth(1).getByText("Tier 2"),
  ).toBeVisible();
});

test("the payload's fields sit on their own rail, apart from the grant-wide ones", async ({
  page,
}) => {
  await openNewBonus(page);
  await page.getByLabel("Add grant").click();
  const grant = page.getByTestId("bonus-grant-row").first();
  const payload = grant.getByTestId("grant-payload");

  await expect(payload.getByText("No stats.")).toBeVisible();
  await expect(payload.getByTestId("grant-scale")).toHaveCount(0);
  await expect(grant.getByTestId("grant-scale")).toBeVisible();

  await grant.getByRole("button", { name: "tiered" }).click();
  await expect(payload.getByTestId("grant-tier-by")).toBeVisible();
  await expect(payload.getByTestId("bonus-tier-row")).toHaveCount(1);
});
