// Every leaf that takes a list -- toggle/role/class/damageType, and a param's `equals` --
// matches it as "one of", so they all edit their values as a set of chips. Requiring several
// values at once is `all`, which stays a group of single-value rows.
import { test, expect, type Page, type Locator } from "@playwright/test";
import { openBuilder } from "./support/app";
import { addLayer, layerRow } from "./support/nav";

/** Opens a fresh layer, switches to its Bonuses tab, starts a new (unsaved) bonus and adds one
 *  grant -- enough to reach both the condition editor and the grant's JSON escape hatch. */
async function openNewGrant(page: Page) {
  await openBuilder(page);
  await addLayer(page);
  await layerRow(page, "Layer 1").locator(".nav-name").click();
  await page.getByRole("button", { name: /Bonuses \d+/ }).click();
  await page.getByTestId("new-bonus").click();
  await page.getByLabel("Add grant").click();
  return page.getByTestId("bonus-grant-row").first();
}

async function openNewConditionLeaf(page: Page) {
  const grant = await openNewGrant(page);
  await page.getByLabel("Add condition").click();
  return { grant, row: page.getByTestId("condition-row").first() };
}

async function setLeafType(row: Locator, type: string) {
  await row.getByTestId("picker-input").first().click();
  await row.getByText(type, { exact: true }).click();
}

/** Types into the chip control and picks the offered option. */
async function addValue(row: Locator, query: string, option: string) {
  const values = row.getByTestId("condition-values");
  await values.getByTestId("token-query").fill(query);
  await values.getByTestId("token-option").filter({ hasText: option }).click();
}

test("a role condition edits several values as chips and saves them as a list", async ({
  page,
}) => {
  const { grant, row } = await openNewConditionLeaf(page);
  await setLeafType(row, "role");

  await addValue(row, "dps", "DPS");
  await addValue(row, "healer", "Healer");

  // Chips read as the labels the Options section shows, not the stored values.
  const chips = row.getByTestId("token-chip");
  await expect(chips).toHaveCount(2);
  await expect(chips.nth(0)).toContainText("DPS");
  await expect(chips.nth(1)).toContainText("Healer");

  await grant.getByLabel("Edit as JSON").click();
  const json = await grant.locator("textarea").inputValue();
  expect(JSON.parse(json).when).toEqual({ role: ["dps", "healer"] });
});

test("one chip saves as a bare value rather than a one-item list", async ({
  page,
}) => {
  const { grant, row } = await openNewConditionLeaf(page);
  await setLeafType(row, "role");
  await addValue(row, "tank", "Tank");

  await grant.getByLabel("Edit as JSON").click();
  const json = await grant.locator("textarea").inputValue();
  expect(JSON.parse(json).when).toEqual({ role: "tank" });
});

test("a removed chip drops out of the saved list", async ({ page }) => {
  const { grant, row } = await openNewConditionLeaf(page);
  await setLeafType(row, "role");

  await addValue(row, "dps", "DPS");
  await addValue(row, "tank", "Tank");
  await expect(row.getByTestId("token-chip")).toHaveCount(2);

  await row.getByTestId("token-chip").first().getByRole("button").click();
  await expect(row.getByTestId("token-chip")).toHaveCount(1);

  await grant.getByLabel("Edit as JSON").click();
  const json = await grant.locator("textarea").inputValue();
  expect(JSON.parse(json).when).toEqual({ role: "tank" });
});

test("a toggle edits several names as chips too", async ({ page }) => {
  const { grant, row } = await openNewConditionLeaf(page);
  await setLeafType(row, "toggle");

  await addValue(row, "combat", "Combat");
  await addValue(row, "party", "Party");
  await expect(row.getByTestId("token-chip")).toHaveCount(2);

  await grant.getByLabel("Edit as JSON").click();
  const json = await grant.locator("textarea").inputValue();
  expect(JSON.parse(json).when).toEqual({ toggle: ["combat", "party"] });
});

test("a grant whose toggle carries a list opens in the form, not as a blank value", async ({
  page,
}) => {
  const grant = await openNewGrant(page);

  await grant.getByLabel("Edit as JSON").click();
  await grant
    .locator("textarea")
    .fill('{"when":{"toggle":["combat","party"]},"stats":{"power":100}}');

  await grant.getByLabel("Use the form").click();

  await expect(grant.locator("textarea")).toHaveCount(0);
  const chips = page
    .getByTestId("condition-row")
    .first()
    .getByTestId("token-chip");
  await expect(chips).toHaveCount(2);
  await expect(chips.nth(0)).toContainText("Combat");
  await expect(chips.nth(1)).toContainText("Party");
});

test("an `all` of single toggles stays a group of single-value rows", async ({
  page,
}) => {
  const grant = await openNewGrant(page);

  await grant.getByLabel("Edit as JSON").click();
  await grant
    .locator("textarea")
    .fill(
      '{"when":{"all":[{"toggle":"combat"},{"toggle":"party"}]},"stats":{"power":100}}',
    );

  await grant.getByLabel("Use the form").click();

  await expect(grant.locator("textarea")).toHaveCount(0);
  // The `all` group's own row, plus one row per toggle inside it.
  await expect(page.getByTestId("condition-row")).toHaveCount(3);
});
