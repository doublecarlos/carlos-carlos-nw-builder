// RepeatableRows lays a row with a lead control out as one grid, the Add/Remove pair first.
// The pair must line up with the row's inputs: centered on a plain row, level with the
// inputs' bottom edge on a row of labeled fields. Runs in Firefox too, since grid sizing is
// where engines differ.
import { test, expect, type Locator, type Page } from "@playwright/test";
import { openBuilder } from "./support/app";
import { addLayer, layerRow } from "./support/nav";
import { showAllFields } from "./support/layerEditor";

async function openLayer(page: Page) {
  await openBuilder(page);
  await addLayer(page);
  await layerRow(page, "Layer 1").locator(".nav-name").click();
}

async function box(target: Locator) {
  const found = await target.boundingBox();
  expect(found).not.toBeNull();
  return found!;
}

/** The pair's box and the input it should line up with, plus the lead's box. */
async function rowParts(row: Locator, input: Locator) {
  return {
    actions: await box(row.getByTestId("repeatable-row-actions")),
    lead: await box(row.getByTestId("repeatable-row-lead")),
    input: await box(input),
  };
}

test(
  "a stat row's pair sits before its picker, centered on it",
  { tag: "@cross-browser" },
  async ({ page }) => {
    await openLayer(page);
    await page.getByTestId("new-item").click();
    await showAllFields(page);
    await page.getByRole("button", { name: "Add stat", exact: true }).click();
    const row = page.locator(".stat-row[data-testid=repeatable-row]").first();
    const { actions, lead, input } = await rowParts(
      row,
      row.getByTestId("repeatable-row-lead").locator("input"),
    );
    expect(actions.x + actions.width).toBeLessThanOrEqual(lead.x);
    // Centered alone would also hold for a pair stretched over the whole row.
    expect(actions.height).toBeLessThan(input.height + 4);
    const middle = (b: { y: number; height: number }) => b.y + b.height / 2;
    expect(Math.abs(middle(actions) - middle(input))).toBeLessThanOrEqual(2);
  },
);

/** A labeled row: the pair sits before the lead, inside its input's height and so below the
 *  label line, with its bottom edge level with the input's. */
async function expectPairLevelWithInput(row: Locator, input: Locator) {
  const { actions, lead, input: field } = await rowParts(row, input);
  expect(actions.x + actions.width).toBeLessThanOrEqual(lead.x);
  expect(actions.y).toBeGreaterThanOrEqual(field.y - 1);
  expect(actions.y + actions.height).toBeLessThanOrEqual(
    field.y + field.height + 1,
  );
  expect(
    Math.abs(actions.y + actions.height - (field.y + field.height)),
  ).toBeLessThanOrEqual(4);
}

test(
  "a bonus input row's pair sits level with its inputs, under their labels",
  { tag: "@cross-browser" },
  async ({ page }) => {
    await openLayer(page);
    await page.getByRole("button", { name: /Bonuses \d+/ }).click();
    await page.getByTestId("new-bonus").click();
    await page.getByTestId("add-bonus-input").first().click();
    const row = page.locator(".bonus-input-row").first();
    await expectPairLevelWithInput(row, row.getByTestId("bonus-input-id"));
  },
);

test(
  "a dynamic stat row's pair sits level with its picker, under its label",
  { tag: "@cross-browser" },
  async ({ page }) => {
    await openLayer(page);
    await page.getByTestId("new-item").click();
    await showAllFields(page);
    await page
      .getByRole("button", { name: "Add dynamic stat", exact: true })
      .click();
    const row = page
      .locator(".dynamic-stat-row[data-testid=repeatable-row]")
      .first();
    await expectPairLevelWithInput(
      row,
      row.getByTestId("repeatable-row-lead").locator("input"),
    );
  },
);
