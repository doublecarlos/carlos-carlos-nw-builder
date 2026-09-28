// End-to-end coverage for authoring formulas in the layer editor: a grant's scale checked as it
// is typed and previewed against the build, named formulas offered to every field, a tier
// measure, and the formula condition leaf, each surviving a save and reopen.
import { test, expect, type Locator, type Page } from "@playwright/test";
import { chooseCombo, openBuilder } from "./support/app";
import { addLayer, layerRow } from "./support/nav";

const BONUS = "ZZZ Test Formula Bonus";

/** Opens a fresh layer on its Bonuses tab and starts a named bonus with one grant. */
async function newBonusWithGrant(page: Page) {
  await openBuilder(page);
  await addLayer(page);
  await layerRow(page, "Layer 1").locator(".nav-name").click();
  await page.getByRole("button", { name: /Bonuses \d+/ }).click();
  await page.getByTestId("new-bonus").click();
  await page.getByTestId("bonus-name-input").fill(BONUS);
  await page.getByLabel("Add grant").click();
}

async function saveAndReopen(page: Page) {
  await page.getByRole("button", { name: "Save bonus" }).click();
  await reopen(page, "Risky Investment");
  await reopen(page, BONUS);
}

async function reopen(page: Page, name: string) {
  await page.locator(".editor-search").fill(name);
  await page.locator(".editor-row", { hasText: name }).first().click();
  await expect(page.getByTestId("bonus-name-input")).toHaveValue(name);
}

async function setLeafType(row: Locator, type: string) {
  await row.getByTestId("picker-input").first().click();
  await row.getByText(type, { exact: true }).click();
}

test("a scale is checked as it is typed and previewed against the build", async ({
  page,
}) => {
  await newBonusWithGrant(page);
  const scale = page.getByTestId("grant-scale");

  await scale.fill("duraton / 5 + 1");
  await expect(page.getByTestId("grant-scale-issue")).toContainText(
    'unknown name "duraton"',
  );
  await expect(scale).toHaveAttribute("aria-invalid", "true");
  await expect(page.getByTestId("grant-scale-preview")).toHaveCount(0);

  // The suggestion is a fix, applied in place.
  await page.getByTestId("grant-scale-fix").click();
  await expect(scale).toHaveValue("duration / 5 + 1");
  await expect(page.getByTestId("grant-scale-issue")).toHaveCount(0);
  // The editor shows no build of its own, so the preview names the one it runs against.
  await expect(page.getByTestId("grant-scale-preview")).toHaveText(
    /On build ".+":\s*\d+ \/ 5 \+ 1 =\s*[\d.]+/,
  );
  await page.getByTestId("grant-scale-label").fill("Ramp");

  await saveAndReopen(page);
  await expect(scale).toHaveValue("duration / 5 + 1");
  await expect(page.getByTestId("grant-scale-label")).toHaveValue("Ramp");
});

test("a label without a formula is flagged, since it is not saved", async ({
  page,
}) => {
  await newBonusWithGrant(page);

  // An empty formula means no scale, so the label alone would be dropped.
  await page.getByTestId("grant-scale-label").fill("Ramp");
  await expect(page.getByTestId("grant-scale-issue")).toHaveText(
    "the label is not saved without a formula",
  );
  await page.getByTestId("grant-scale").fill("duration / 5");
  await expect(page.getByTestId("grant-scale-issue")).toHaveCount(0);
});

test("a named formula is offered to every field and lends it its label", async ({
  page,
}) => {
  await newBonusWithGrant(page);

  await page.getByTestId("add-bonus-formula").click();
  const name = page.getByTestId("bonus-formula-name");
  await name.fill("1x");
  await expect(page.getByTestId("bonus-formula-name-issue")).toBeVisible();
  await name.fill("stacks");
  await expect(page.getByTestId("bonus-formula-name-issue")).toHaveCount(0);
  // A named row is saved even without a formula, so the missing one is flagged.
  await expect(page.getByTestId("bonus-formula-issue")).toHaveText(
    "formula is empty",
  );
  await page.getByTestId("bonus-formula").fill("min(floor(duration / 5), 5)");
  await expect(page.getByTestId("bonus-formula-issue")).toHaveCount(0);
  await page.getByTestId("bonus-formula-label").fill("Stacks");

  // Picked from the reference list, the name lands in the field it was opened from.
  await page.getByTestId("grant-scale-reference-toggle").click();
  await page
    .getByTestId("grant-scale-reference")
    .getByTestId("grant-scale-reference-item")
    .filter({ hasText: "$stacks" })
    .click();
  await expect(page.getByTestId("grant-scale")).toHaveValue("$stacks");
  await expect(page.getByTestId("grant-scale-label")).toHaveAttribute(
    "placeholder",
    "Stacks",
  );

  // A tier measure reads the same names.
  await page.getByRole("button", { name: "tiered", exact: true }).click();
  const measure = page.getByTestId("grant-tier-by");
  await expect(measure).toHaveAttribute("placeholder", "occurrences()");
  await measure.fill("$stack");
  await expect(page.getByTestId("grant-tier-by-issue")).toContainText(
    '"$stack" is not a formula of this bonus',
  );
  await page.getByTestId("grant-tier-by-fix").click();
  await expect(measure).toHaveValue("$stacks");

  await saveAndReopen(page);
  await expect(page.getByTestId("bonus-formula-name")).toHaveValue("stacks");
  await expect(page.getByTestId("bonus-formula-label")).toHaveValue("Stacks");
  await expect(page.getByTestId("grant-tier-by")).toHaveValue("$stacks");
  await expect(page.getByTestId("grant-scale")).toHaveValue("$stacks");
});

test("a formula condition leaf edits its formula and range", async ({
  page,
}) => {
  await newBonusWithGrant(page);
  await page.getByLabel("Add condition").click();
  const row = page.getByTestId("condition-row").first();
  await setLeafType(row, "formula");

  await row.getByTestId("condition-formula").fill("enemies * 2");
  await row.locator('input[type="number"]').first().fill("4");

  await saveAndReopen(page);
  await expect(page.getByTestId("condition-formula")).toHaveValue(
    "enemies * 2",
  );
  const grant = page.getByTestId("bonus-grant-row").first();
  await grant.getByLabel("Edit as JSON").click();
  const json = await grant.locator("textarea").inputValue();
  expect(json).toContain('"formula": "enemies * 2"');
  expect(json).toContain('"atLeast": 4');
});

test("a scale counting its own occurrences warns under perSource stacking", async ({
  page,
}) => {
  await newBonusWithGrant(page);
  await page.getByTestId("grant-scale").fill("min(occurrences(), 3)");
  await expect(page.getByTestId("grant-scale-issue")).toHaveCount(0);

  await chooseCombo(
    page.getByTestId("bonus-stacking"),
    "once per contributing slot",
  );
  await expect(page.getByTestId("grant-scale-issue")).toContainText(
    "perSource stacking already multiplies by",
  );
  // A warning, so the formula still previews.
  await expect(page.getByTestId("grant-scale-preview")).toBeVisible();
});
