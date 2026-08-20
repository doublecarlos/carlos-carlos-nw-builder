// End-to-end coverage for the stat panel's compare lines (CompareLine.vue): the compare
// build's own number stacked under this build's, inside the same cell. compare.spec.ts covers
// the editor side of the same picker (row highlighting and applying a diff).
import { test, expect, type Page } from "@playwright/test";
import { openBuilder, chooseClass, chooseCombo } from "./support/app";

const comparePicker = (page: Page) => page.locator(".compare-select");
const compareToggle = (page: Page) =>
  page.getByRole("checkbox", { name: "Compare stats" });
const statRow = (page: Page, key: string) =>
  page.locator(`[data-stat-row="${key}"]`);
const compareLines = (page: Page) =>
  page.locator('[data-testid="compare-line"]');
/** The compare line inside a stat's *value* cell -- the row's label cell carries one too
 * (the compare build's name), and both answer to the same test id. */
const compareValue = (page: Page, key: string) =>
  statRow(page, key).locator(
    '[data-testid="stat-value"] [data-testid="compare-line"]',
  );

/** This build's own number for a stat, with any compare line inside the cell stripped off. */
async function ownValue(page: Page, key: string) {
  const cell = statRow(page, key).getByTestId("stat-value");
  const whole = (await cell.innerText()).trim();
  const line = compareValue(page, key);
  if ((await line.count()) === 0) return whole;
  return whole.replace((await line.innerText()).trim(), "").trim();
}

test("the toggle stays disabled until a compare build is picked", async ({
  page,
}) => {
  await openBuilder(page);
  await expect(compareToggle(page)).toBeDisabled();
  await expect(compareLines(page)).toHaveCount(0);
});

test("a differing stat stacks the compare build's own value under this build's", async ({
  page,
}) => {
  await openBuilder(page);
  // A class carries stats of its own, so picking one here and leaving the second build
  // classless is enough to move most of the panel apart.
  await chooseClass(page, "warlock");
  const firstBuildHp = await ownValue(page, "hp");
  const firstBuildPower = await ownValue(page, "power");

  await page.getByTestId("nav-add-build").click();
  await chooseCombo(comparePicker(page), "Build 1");
  // Picking a compare build alone changes nothing in the panel -- the lines are opt-in.
  await expect(compareLines(page)).toHaveCount(0);

  await compareToggle(page).check();
  await expect(compareValue(page, "hp")).toHaveText(firstBuildHp);
  await expect(compareValue(page, "power")).toHaveText(firstBuildPower);
  // ...and the second build's own numbers are still the ones on the primary line.
  expect(await ownValue(page, "hp")).not.toBe(firstBuildHp);
});

test("the compare line is labelled with the compare build's name", async ({
  page,
}) => {
  await openBuilder(page);
  await chooseClass(page, "warlock");

  await page.getByTestId("nav-add-build").click();
  await chooseCombo(comparePicker(page), "Build 1");
  await compareToggle(page).check();

  await expect(
    statRow(page, "hp").locator('[data-testid="compare-line"]').first(),
  ).toHaveText("↳ Build 1");
});

test("stats the two builds agree on grow no compare line at all", async ({
  page,
}) => {
  await openBuilder(page);
  await chooseClass(page, "warlock");

  await page.getByTestId("nav-add-build").click();
  await chooseCombo(comparePicker(page), "Build 1");
  await compareToggle(page).check();
  await expect(compareValue(page, "hp")).toBeVisible();

  // Same class in both builds: nothing left to differ, so every line disappears rather than
  // filling the panel with repeated numbers.
  await chooseClass(page, "warlock");
  await expect(compareLines(page)).toHaveCount(0);
});
