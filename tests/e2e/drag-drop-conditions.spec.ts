// End-to-end coverage for the new drag-and-drop capability in issue #182: dragging a
// condition (or condition group) to reorder it, and -- the issue's headline example --
// dragging an existing condition into a freshly-added "not" block, including across grants,
// variants, and (via BonusGroups' cross-bonus registry) across bonuses on the same item.
import { test, expect, type Page } from "@playwright/test";
import { openBuilder } from "./support/app";
import { addLayer, layerRow } from "./support/nav";
import { dragOnto } from "./support/dragDrop";

/** Opens a fresh layer, switches to its Bonus sets tab, and starts a new (unsaved) set --
 *  enough to reach BonusRows.vue's grants and their condition trees without saving. */
async function openNewBonusSet(page: Page) {
  await openBuilder(page);
  await addLayer(page);
  await layerRow(page, "Layer 1").locator(".nav-name").click();
  await page.getByRole("button", { name: /Bonus sets \d+/ }).click();
  await page.getByTestId("new-bonus-set").click();
}

test("dragging a condition group reorders it within the same branch", async ({
  page,
}) => {
  await openNewBonusSet(page);
  await page.getByTitle("Add grant").click();

  await page
    .getByTestId("condition-empty-drop")
    .getByTitle('Add "Not" condition group')
    .click();

  // `.first()` throughout: a group row's own toolbar button and its (still-empty) branch's
  // duplicate "add" button share the same title, and the row's own comes first in DOM order.
  const rows = page.getByTestId("condition-row");
  await rows.nth(0).getByTitle('Add "Any of" condition group').first().click();
  await rows.nth(1).getByTitle('Add "All of" condition group').first().click();

  // All three branches start empty, so each row's own op-label is the only one under it --
  // safe to read in plain DOM order without scoping per row.
  const opLabels = page.getByTestId("condition-op-label");
  await expect(rows).toHaveCount(3);
  await expect(opLabels).toHaveText(["not", "any of", "all of"]);

  // Drag the "not" group onto the "all of" group -- lands right after it.
  await dragOnto(
    rows.nth(0).getByTestId("condition-drag-handle"),
    rows.nth(2),
    "after",
  );

  await expect(opLabels).toHaveText(["any of", "all of", "not"]);
});

test("dragging an existing condition into a freshly-added 'not' block moves it inside", async ({
  page,
}) => {
  await openNewBonusSet(page);
  await page.getByTitle("Add grant").click();

  await page
    .getByTestId("condition-empty-drop")
    .getByTitle("Add condition")
    .click();

  const rows = page.getByTestId("condition-row");
  await expect(rows).toHaveCount(1);
  await rows.nth(0).getByTitle('Add "Not" condition group').click();
  await expect(rows).toHaveCount(2);

  const notGroupBoxBefore = rows.nth(1).getByTestId("condition-group-box");
  await expect(notGroupBoxBefore.getByTestId("condition-row")).toHaveCount(0);

  // Drag the leaf (row 0) into the "not" group's own (still-empty) branch.
  await dragOnto(
    rows.nth(0).getByTestId("condition-drag-handle"),
    notGroupBoxBefore.getByTestId("condition-empty-drop"),
  );

  // The leaf moved inside the group -- total row count is unchanged (nothing was lost or
  // duplicated), but it now nests under the "not" instead of sitting beside it. Only one
  // top-level row remains at this point (the "not" group, now at index 0 since the leaf
  // ahead of it is gone) -- re-resolve its box fresh rather than reusing the pre-drag
  // `rows.nth(1)` locator, which pointed at an index that no longer exists.
  await expect(rows).toHaveCount(2);
  const notGroupBoxAfter = rows.nth(0).getByTestId("condition-group-box");
  await expect(notGroupBoxAfter.getByTestId("condition-row")).toHaveCount(1);
});

test("dragging a condition from one grant's Active when to another's moves it across trees", async ({
  page,
}) => {
  await openNewBonusSet(page);
  const addGrant = page.getByTitle("Add grant");
  await addGrant.click();
  await addGrant.click();

  const grantRows = page.getByTestId("bonus-grant-row");
  await expect(grantRows).toHaveCount(2);

  await grantRows
    .nth(0)
    .getByTestId("condition-empty-drop")
    .getByTitle("Add condition")
    .click();

  const grant1Rows = grantRows.nth(0).getByTestId("condition-row");
  const grant2Empty = grantRows.nth(1).getByTestId("condition-empty-drop");
  await expect(grant1Rows).toHaveCount(1);

  await dragOnto(
    grant1Rows.nth(0).getByTestId("condition-drag-handle"),
    grant2Empty,
  );

  await expect(grant1Rows).toHaveCount(0);
  await expect(grantRows.nth(1).getByTestId("condition-row")).toHaveCount(1);
});

test("dragging a condition between two bonuses on the same item moves it across bonuses", async ({
  page,
}) => {
  await openBuilder(page);
  await addLayer(page);
  await layerRow(page, "Layer 1").locator(".nav-name").click();
  await page.getByTestId("new-item").click();
  await page.getByTestId("item-name-input").fill("ZZZ Cross Bonus Drag Item");
  await page.getByTestId("item-filter-input").fill("gear_head");

  const addBonus = page.getByTitle("Add bonus");
  await addBonus.click();
  await addBonus.click();

  const bonusCards = page.getByTestId("bonus-card");
  await expect(bonusCards).toHaveCount(2);

  await bonusCards.nth(0).getByTitle("Add grant").click();
  await bonusCards.nth(1).getByTitle("Add grant").click();

  await bonusCards
    .nth(0)
    .getByTestId("condition-empty-drop")
    .getByTitle("Add condition")
    .click();

  const bonus1Rows = bonusCards.nth(0).getByTestId("condition-row");
  const bonus2Empty = bonusCards.nth(1).getByTestId("condition-empty-drop");
  await expect(bonus1Rows).toHaveCount(1);

  await dragOnto(
    bonus1Rows.nth(0).getByTestId("condition-drag-handle"),
    bonus2Empty,
  );

  await expect(bonus1Rows).toHaveCount(0);
  await expect(bonusCards.nth(1).getByTestId("condition-row")).toHaveCount(1);
});
