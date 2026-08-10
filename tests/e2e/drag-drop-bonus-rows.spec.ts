// End-to-end coverage for dragging to reorder grants (issue #182). Tiers/variants use the
// exact same useDropList/useDragHandle wiring as grants (see BonusRows.vue), so grant
// reordering alone is representative coverage for that shared code path; this spec doesn't
// duplicate it three times over.
import { test, expect } from "@playwright/test";
import { openBuilder } from "./support/app";
import { addLayer, layerRow } from "./support/nav";
import { dragOnto } from "./support/dragDrop";

/** Opens a fresh layer, switches to its Bonus sets tab, and starts a new (unsaved) set --
 *  enough to reach BonusRows.vue's grants list without needing to save anything. */
async function openNewBonusSet(page: import("@playwright/test").Page) {
  await openBuilder(page);
  await addLayer(page);
  await layerRow(page, "Layer 1").locator(".nav-name").click();
  await page.getByRole("button", { name: /Bonus sets \d+/ }).click();
  await page.getByTestId("new-bonus-set").click();
}

test("dragging a grant row onto another reorders the grant list", async ({
  page,
}) => {
  await openNewBonusSet(page);

  const addGrant = page.getByTitle("Add grant");
  await addGrant.click();
  await addGrant.click();
  await addGrant.click();

  const descriptions = page.getByTestId("grant-short-description");
  await expect(descriptions).toHaveCount(3);
  await descriptions.nth(0).fill("First");
  await descriptions.nth(1).fill("Second");
  await descriptions.nth(2).fill("Third");

  const rows = page.getByTestId("bonus-grant-row");
  // Drag the first grant onto the third -- lands right after it.
  await dragOnto(
    rows.nth(0).getByTestId("grant-drag-handle"),
    rows.nth(2),
    "after",
  );

  await expect(descriptions.nth(0)).toHaveValue("Second");
  await expect(descriptions.nth(1)).toHaveValue("Third");
  await expect(descriptions.nth(2)).toHaveValue("First");
});

test("Move grant up still works after drag-and-drop is wired in", async ({
  page,
}) => {
  await openNewBonusSet(page);

  const addGrant = page.getByTitle("Add grant");
  await addGrant.click();
  await addGrant.click();

  const descriptions = page.getByTestId("grant-short-description");
  await descriptions.nth(0).fill("First");
  await descriptions.nth(1).fill("Second");

  await page
    .getByTestId("bonus-grant-row")
    .nth(1)
    .getByTitle("Move grant up")
    .click();

  await expect(descriptions.nth(0)).toHaveValue("Second");
  await expect(descriptions.nth(1)).toHaveValue("First");
});
