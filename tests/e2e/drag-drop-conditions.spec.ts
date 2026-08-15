// End-to-end coverage for the new drag-and-drop capability in issue #182: dragging a
// condition (or condition group) to reorder it, and -- the issue's headline example --
// dragging an existing condition into a freshly-added "not" block, including across grants,
// variants, and (via ItemBonuses' cross-bonus registry) across bonuses on the same item.
import { test, expect, type Page } from "@playwright/test";
import { openBuilder } from "./support/app";
import { addLayer, layerRow } from "./support/nav";
import { dragOnto } from "./support/dragDrop";

/** Opens a fresh layer, switches to its Bonuses tab, and starts a new (unsaved) bonus --
 *  enough to reach BonusRows.vue's grants and their condition trees without saving. */
async function openNewBonus(page: Page) {
  await openBuilder(page);
  await addLayer(page);
  await layerRow(page, "Layer 1").locator(".nav-name").click();
  await page.getByRole("button", { name: /Bonuses \d+/ }).click();
  await page.getByTestId("new-bonus").click();
}

test("dragging a condition group reorders it within the same branch", async ({
  page,
}) => {
  await openNewBonus(page);
  await page.getByTitle("Add grant").click();

  // Nested branches get their own (initially empty) `condition-empty-drop` too, but this
  // grant's own trailing toolbar is always the last one in DOM order -- every nested one is
  // rendered inside an earlier row, closed before this instance's own trailing div opens.
  const emptyDrop = page.getByTestId("condition-empty-drop").last();
  await emptyDrop.getByTitle('Add "Not" condition group').click();
  await emptyDrop.getByTitle('Add "Any of" condition group').click();
  await emptyDrop.getByTitle('Add "All of" condition group').click();

  // All three branches start empty, so each row's own op-label is the only one under it --
  // safe to read in plain DOM order without scoping per row.
  const rows = page.getByTestId("condition-row");
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

test("dragging a branch reorders it within its group", async ({ page }) => {
  await openNewBonus(page);
  await page.getByTitle("Add grant").click();

  await page
    .getByTestId("condition-empty-drop")
    .last()
    .getByTitle('Add "Any of" condition group')
    .click();

  const branches = page.getByTestId("condition-branch");
  await expect(branches).toHaveCount(2);

  // Give each branch a distinguishable leaf so the drag's effect on branch *content* (not
  // just the "Condition N" label, which always reflects plain position) is observable.
  await branches.nth(0).getByTitle("Add condition").click();
  await branches.nth(1).getByTitle("Add condition").click();

  const leafType = (bi: number) =>
    branches
      .nth(bi)
      .getByTestId("condition-row")
      .getByTestId("picker-input")
      .first();
  await leafType(0).click();
  await branches.nth(0).getByText("class", { exact: true }).click();
  await leafType(1).click();
  await branches.nth(1).getByText("enemies", { exact: true }).click();

  await expect(leafType(0)).toHaveValue("class");
  await expect(leafType(1)).toHaveValue("enemies");

  // Drag branch 0 onto branch 1 -- lands after it, so their content swaps places.
  await dragOnto(
    branches.nth(0).getByTestId("condition-branch-drag-handle"),
    branches.nth(1),
    "after",
  );

  await expect(leafType(0)).toHaveValue("enemies");
  await expect(leafType(1)).toHaveValue("class");
});

test("dragging a branch into a different group moves it there", async ({
  page,
}) => {
  await openNewBonus(page);
  await page.getByTitle("Add grant").click();

  const emptyDrop = page.getByTestId("condition-empty-drop").last();
  await emptyDrop.getByTitle('Add "Any of" condition group').click();
  await emptyDrop.getByTitle('Add "All of" condition group').click();

  const groups = page.getByTestId("condition-group-box");
  await expect(groups).toHaveCount(2);
  const group1Branches = groups.nth(0).getByTestId("condition-branch");
  const group2Branches = groups.nth(1).getByTestId("condition-branch");
  await expect(group1Branches).toHaveCount(2);
  await expect(group2Branches).toHaveCount(2);

  // Mark the dragged branch's content so we can confirm it -- not just an empty slot --
  // followed the drag into the other group.
  await group1Branches.nth(0).getByTitle("Add condition").click();
  const draggedLeafType = group1Branches
    .nth(0)
    .getByTestId("condition-row")
    .getByTestId("picker-input")
    .first();
  await draggedLeafType.click();
  await group1Branches.nth(0).getByText("class", { exact: true }).click();

  // Drag group 1's marked branch onto group 2's last branch -- lands after it.
  await dragOnto(
    group1Branches.nth(0).getByTestId("condition-branch-drag-handle"),
    group2Branches.nth(1),
    "after",
  );

  await expect(group1Branches).toHaveCount(1);
  await expect(group2Branches).toHaveCount(3);
  const movedLeafType = group2Branches
    .nth(2)
    .getByTestId("condition-row")
    .getByTestId("picker-input")
    .first();
  await expect(movedLeafType).toHaveValue("class");
});

test("dragging an existing condition into a freshly-added 'not' block moves it inside", async ({
  page,
}) => {
  await openNewBonus(page);
  await page.getByTitle("Add grant").click();

  // Both the leaf and the "not" group are appended via this grant's own trailing toolbar --
  // there's no per-row "add" button anymore, only this rows-list-level one.
  const emptyDrop = page.getByTestId("condition-empty-drop").last();
  await emptyDrop.getByTitle("Add condition").click();
  await emptyDrop.getByTitle('Add "Not" condition group').click();

  const rows = page.getByTestId("condition-row");
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
  await openNewBonus(page);
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
