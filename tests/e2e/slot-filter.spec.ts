// End-to-end coverage for BuildEditor.vue's text/stat slot filter (issue #130): narrowing the
// visible slots and sections, the section-header-match override, forcing a matching but
// manually-collapsed section back open, and the clear-filters affordance.
import { test, expect } from "@playwright/test";
import {
  openBuilder,
  headerRow,
  slotRow,
  chooseCombo,
  chooseItem,
  slotFilterInput,
  slotFilterStatCombo,
  slotFilterClearButton,
} from "./support/app";

test.describe("slot filter: text", () => {
  test("typing a slot label shows only matching slots and hides sections with no match", async ({
    page,
  }) => {
    await openBuilder(page);
    await slotFilterInput(page).fill("Arms");

    await expect(slotRow(page, "gear.arms")).toBeVisible();
    await expect(slotRow(page, "gear.head")).toBeHidden();
    // Options has no slot or header matching "Arms", so it disappears entirely.
    await expect(headerRow(page, "options")).toBeHidden();
  });

  test("a matching section header shows every slot underneath, unfiltered", async ({
    page,
  }) => {
    await openBuilder(page);
    await slotFilterInput(page).fill("Options");

    await expect(headerRow(page, "options")).toBeVisible();
    await expect(slotRow(page, "options.class")).toBeVisible();
    await expect(slotRow(page, "options.role")).toBeVisible();
  });

  test("filtering forces a manually-collapsed matching section back open", async ({
    page,
  }) => {
    await openBuilder(page);
    await headerRow(page, "gear").click();
    await expect(slotRow(page, "gear.head")).toBeHidden();

    await slotFilterInput(page).fill("Head");
    await expect(slotRow(page, "gear.head")).toBeVisible();
  });

  test("clearing the filter restores the collapse state from before filtering", async ({
    page,
  }) => {
    await openBuilder(page);
    await headerRow(page, "gear").click();
    await expect(slotRow(page, "gear.head")).toBeHidden();

    await slotFilterInput(page).fill("Head");
    await expect(slotRow(page, "gear.head")).toBeVisible();

    await slotFilterClearButton(page).click();
    await expect(slotRow(page, "gear.head")).toBeHidden();
  });
});

test.describe("slot filter: stat", () => {
  test("selecting a stat shows only slots with a selectable item granting it", async ({
    page,
  }) => {
    await openBuilder(page);
    await chooseCombo(slotFilterStatCombo(page), "Power (power)");

    // gear.arms has an item granting power directly; gear.head has none.
    await expect(slotRow(page, "gear.arms")).toBeVisible();
    await expect(slotRow(page, "gear.head")).toBeHidden();
  });

  test("text and stat filters combine", async ({ page }) => {
    await openBuilder(page);
    await slotFilterInput(page).fill("Arms");
    await chooseCombo(slotFilterStatCombo(page), "Power (power)");
    await expect(slotRow(page, "gear.arms")).toBeVisible();

    // Head no longer matches the stat filter, so it's gone even though it wouldn't have
    // matched the text query anyway.
    await expect(slotRow(page, "gear.head")).toBeHidden();

    // Switch the text query to something that only Head matches -- now nothing in gear
    // satisfies both filters at once, and the whole section disappears.
    await slotFilterInput(page).fill("Head");
    await expect(headerRow(page, "gear")).toBeHidden();
  });

  test("a slot also matches through an active bonus, not just an item's own stats", async ({
    page,
  }) => {
    await openBuilder(page);
    // "Prime Rib (Power)" carries no `power` stat of its own -- it grants +4000 Power through
    // an active bonus (gated only on the "Consumables" toggle, checked by default) once
    // equipped, so the Food slot only matches the Power filter after it's chosen.
    await chooseCombo(slotFilterStatCombo(page), "Power (power)");
    await expect(slotRow(page, "buffs.food")).toBeHidden();

    await slotFilterClearButton(page).click();
    await chooseItem(page, "buffs.food", "Prime Rib (Power)");

    await chooseCombo(slotFilterStatCombo(page), "Power (power)");
    await expect(slotRow(page, "buffs.food")).toBeVisible();
  });
});

test.describe("clear filters button", () => {
  test("is disabled with no filter applied, and enables once one is", async ({
    page,
  }) => {
    await openBuilder(page);
    await expect(slotFilterClearButton(page)).toBeDisabled();

    await slotFilterInput(page).fill("Arms");
    await expect(slotFilterClearButton(page)).toBeEnabled();

    await slotFilterClearButton(page).click();
    await expect(slotFilterInput(page)).toHaveValue("");
    await expect(slotFilterClearButton(page)).toBeDisabled();
  });

  test("shows a match count while a filter is active", async ({ page }) => {
    await openBuilder(page);
    await expect(page.getByTestId("slot-filter-count")).toBeHidden();

    await slotFilterInput(page).fill("Arms");
    await expect(page.getByTestId("slot-filter-count")).toHaveText("1 match");
  });
});
