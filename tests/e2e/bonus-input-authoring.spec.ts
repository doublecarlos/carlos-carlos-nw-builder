// Authoring a bonus's inputs in the layer editor, and gating a grant on one through the
// "input" condition leaf.
import { test, expect, type Locator, type Page } from "@playwright/test";
import { openBuilder, chooseCombo } from "./support/app";
import { addLayer, layerRow } from "./support/nav";

const BONUS = "ZZZ Test Input Bonus";

async function openNewBonus(page: Page) {
  await openBuilder(page);
  await addLayer(page);
  await layerRow(page, "Layer 1").locator(".nav-name").click();
  await page.getByRole("button", { name: /Bonuses \d+/ }).click();
  await page.getByTestId("new-bonus").click();
  await page.getByTestId("bonus-name-input").fill(BONUS);
}

async function addInput(page: Page, name: string): Promise<Locator> {
  await page.getByRole("button", { name: "Add input" }).first().click();
  const row = page.locator(".bonus-input-row").last();
  await row.getByTestId("bonus-input-id").fill(name);
  return row;
}

/** Adds a grant with one `input` leaf and returns the leaf's row. */
async function addInputCondition(page: Page): Promise<Locator> {
  await page.getByLabel("Add grant").click();
  await page.getByLabel("Add condition").click();
  const row = page.getByTestId("condition-row").first();
  await chooseCombo(row, "input");
  return row;
}

async function openEditorRow(page: Page, text: string) {
  await page.locator(".editor-search").fill(text);
  await page.locator(".editor-row", { hasText: text }).first().click();
}

test("a boolean input gates a grant and survives reopening", async ({
  page,
}) => {
  await openNewBonus(page);
  const input = await addInput(page, "procActive");
  await input.getByTestId("bonus-input-label").fill("Proc");

  const leaf = await addInputCondition(page);
  // The id sits under the label, as a bonus's id does.
  const key = leaf.getByTestId("condition-input-key");
  await key.getByTestId("picker-input").click();
  await expect(key.getByTestId("bonus-option-id")).toHaveText("procActive");
  await key.getByText("Proc", { exact: true }).click();
  await chooseCombo(leaf.getByTestId("condition-is"), "on");
  await page.getByRole("button", { name: "Save bonus" }).click();

  // Leave for another bonus and come back: the form is rebuilt from what was saved.
  await openEditorRow(page, "Risky Investment");
  await expect(page.getByTestId("bonus-name-input")).toHaveValue(
    "Risky Investment",
  );
  await openEditorRow(page, BONUS);
  // A saved input's id is frozen: builds store its value under it.
  const id = page.getByTestId("bonus-input-id");
  await expect(id).toContainText("procActive");
  await expect(id.getByRole("textbox")).toHaveCount(0);
  await expect(page.getByTestId("bonus-input-label")).toHaveValue("Proc");

  const grant = page.getByTestId("bonus-grant-row").first();
  await expect(
    grant.getByTestId("condition-input-key").getByTestId("picker-input"),
  ).toHaveValue("Proc");
  await grant.getByLabel("Edit as JSON").click();
  const json = JSON.parse(await grant.locator("textarea").inputValue());
  expect(json.when).toEqual({ input: { key: "procActive", is: true } });
});

test("an input added to a saved bonus stays editable until it is reopened", async ({
  page,
}) => {
  await openNewBonus(page);
  await addInput(page, "procActive");
  await page.getByRole("button", { name: "Save bonus" }).click();
  await openEditorRow(page, "Risky Investment");
  await openEditorRow(page, BONUS);

  // The bonus now saves live, but the new id is still being typed.
  const added = await addInput(page, "stack");
  await added.getByTestId("bonus-input-id").fill("stacks");
  await expect(added.getByTestId("bonus-input-id")).toHaveValue("stacks");

  await openEditorRow(page, "Risky Investment");
  await openEditorRow(page, BONUS);
  const reopened = page.locator(".bonus-input-row").last();
  await expect(reopened.getByTestId("bonus-input-id")).toContainText("stacks");
  await expect(
    reopened.getByTestId("bonus-input-id").getByRole("textbox"),
  ).toHaveCount(0);
});

test("a number input takes bounds and a range condition", async ({ page }) => {
  await openNewBonus(page);
  const input = await addInput(page, "stacks");
  await chooseCombo(input.getByTestId("bonus-input-type"), "number");
  await input.getByTestId("bonus-input-min").fill("0");
  await input.getByTestId("bonus-input-max").fill("5");
  await input.getByTestId("bonus-input-default").fill("2");
  await expect(input.getByTestId("bonus-input-control")).toBeVisible();

  const leaf = await addInputCondition(page);
  await chooseCombo(leaf.getByTestId("condition-input-key"), "stacks");
  await expect(leaf.getByTestId("condition-is")).toHaveCount(0);
  await leaf.locator('input[type="number"]').first().fill("3");

  const grant = page.getByTestId("bonus-grant-row").first();
  await grant.getByLabel("Edit as JSON").click();
  const json = JSON.parse(await grant.locator("textarea").inputValue());
  expect(json.when).toEqual({ input: { key: "stacks", atLeast: 3 } });
});

test("a percent input's numbers are typed in percent and saved as decimals", async ({
  page,
}) => {
  await openNewBonus(page);
  const input = await addInput(page, "share");
  await chooseCombo(input.getByTestId("bonus-input-type"), "percent");
  const field = (key: string) =>
    input.getByTestId(`bonus-input-${key}`).locator("input");
  await field("min").fill("0");
  await field("max").fill("100");
  await field("step").fill("5");
  await field("default").fill("25");
  await input.getByTestId("bonus-input-presets").fill("10, 50%");
  await page.getByRole("button", { name: "Save bonus" }).click();

  await openEditorRow(page, "Risky Investment");
  await openEditorRow(page, BONUS);
  const reopened = page.locator(".bonus-input-row").last();
  await expect(
    reopened.getByTestId("bonus-input-default").locator("input"),
  ).toHaveValue("25");
  await expect(
    reopened.getByTestId("bonus-input-max").locator("input"),
  ).toHaveValue("100");
  await expect(reopened.getByTestId("bonus-input-presets")).toHaveValue(
    "10, 50",
  );
});

/** A percent input, and the grant JSON its leaf or scale produces. */
async function percentInput(page: Page) {
  await openNewBonus(page);
  const input = await addInput(page, "share");
  await chooseCombo(input.getByTestId("bonus-input-type"), "percent");
  return input;
}

async function grantJson(page: Page) {
  const grant = page.getByTestId("bonus-grant-row").first();
  await grant.getByLabel("Edit as JSON").click();
  return JSON.parse(await grant.locator("textarea").inputValue());
}

test("a percent input's range condition is typed in percent", async ({
  page,
}) => {
  await percentInput(page);
  const leaf = await addInputCondition(page);
  await chooseCombo(leaf.getByTestId("condition-input-key"), "share");
  await leaf.locator('input[inputmode="decimal"]').first().fill("25");
  expect((await grantJson(page)).when).toEqual({
    input: { key: "share", atLeast: 0.25 },
  });
});

test("a ladder over a percent input takes its bounds in percent", async ({
  page,
}) => {
  await percentInput(page);
  await page.getByLabel("Add grant").click();
  await page.getByTestId("grant-scale").fill("$share");
  await page.getByTestId("grant-scale-steps-over").fill("$share");
  const field = (key: string) =>
    page.getByTestId(`grant-scale-steps-${key}`).locator("input");
  await field("min").fill("0");
  await field("max").fill("100");
  await field("step").fill("25");
  expect((await grantJson(page)).scale.steps).toEqual({
    over: "$share",
    min: 0,
    max: 1,
    step: 0.25,
  });
});

test("a repeated input id is flagged", async ({ page }) => {
  await openNewBonus(page);
  await addInput(page, "stacks");
  await expect(page.getByTestId("bonus-input-duplicate")).toHaveCount(0);
  await page.getByRole("button", { name: "Add input" }).first().click();
  await page
    .locator(".bonus-input-row")
    .last()
    .getByTestId("bonus-input-id")
    .fill("stacks");
  await expect(page.getByTestId("bonus-input-duplicate")).toContainText(
    "stacks",
  );
});
