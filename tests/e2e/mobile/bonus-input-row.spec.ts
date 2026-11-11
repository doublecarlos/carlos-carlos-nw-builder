// Build-row value inputs on a phone (BuildInputControl through InputRow) keep the desktop's
// layout: the control in a fixed leading column, its label beside it, wrapping as needed and
// centered on the control, with any presets following the label. The quick options sheet has
// few, long-labeled params, so it reads label first, then the field with its presets.
import { test, expect, type Locator, type Page } from "@playwright/test";
import { openBuilder } from "../support/app";
import { BONUS_ID, openWithBonusInputs } from "../support/bonusInputBuild";
import { MIN_SUPPORTED_WIDTH } from "../support/viewport";

async function box(locator: Locator) {
  const b = await locator.boundingBox();
  if (!b) throw new Error("Not visible");
  return b;
}

/** `control` sits left of `label`, the two centered on one another, inside `row`. */
async function expectControlThenLabel(
  row: Locator,
  control: Locator,
  label: Locator,
) {
  const rowBox = await box(row);
  const controlBox = await box(control);
  const labelBox = await box(label);
  expect(controlBox.x).toBeGreaterThanOrEqual(rowBox.x - 1);
  expect(controlBox.x + controlBox.width).toBeLessThanOrEqual(labelBox.x);
  expect(
    Math.abs(
      controlBox.y + controlBox.height / 2 - (labelBox.y + labelBox.height / 2),
    ),
  ).toBeLessThanOrEqual(2);
}

const inputRowOf = (page: Page, row: Locator, key: string) =>
  row
    .getByTestId("input-row")
    .filter({ has: page.getByTestId(`bonus-input-${BONUS_ID}-${key}`) });

for (const width of [MIN_SUPPORTED_WIDTH, 412]) {
  test.describe(`at ${width}px`, () => {
    test.use({ viewport: { width, height: 800 } });

    test("a build row's input sits left of its label, every control in one column", async ({
      page,
    }) => {
      const row = await openWithBonusInputs(page);
      const starts: number[] = [];
      for (const key of ["stacks", "share"]) {
        const inputRow = inputRowOf(page, row, key);
        const control = inputRow.getByTestId("input-row-control");
        const description = inputRow.getByTestId("input-row-description");
        await expectControlThenLabel(inputRow, control, description);
        starts.push((await box(description)).x);
      }
      // Labels start at one x, so the controls read as a column.
      expect(Math.abs(starts[0] - starts[1])).toBeLessThanOrEqual(1);
    });

    test("presets follow the label and set the value", async ({ page }) => {
      const row = await openWithBonusInputs(page);
      const inputRow = inputRowOf(page, row, "share");
      const description = inputRow.getByTestId("input-row-description");
      await expect(description.getByRole("button")).toHaveText([
        "0",
        "50",
        "100",
      ]);
      await expect(description).toContainText("(from 0 to 100)");

      await description.getByRole("button", { name: "50" }).tap();
      await expect(
        page.getByTestId(`bonus-input-${BONUS_ID}-share`),
      ).toHaveValue("50");
    });

    test("a quick option reads label, then field with presets beside it", async ({
      page,
    }) => {
      await openBuilder(page);
      await page.getByTestId("quick-band-toggle").first().click();
      const param = page.getByTestId("quick-param-options.duration");
      const label = await box(param.getByText("Duration (s)"));
      const field = await box(param.getByRole("spinbutton"));
      const preset = await box(param.getByRole("button", { name: "30" }));
      expect(label.y + label.height).toBeLessThanOrEqual(field.y + 1);
      expect(Math.abs(field.x - label.x)).toBeLessThanOrEqual(1);
      expect(preset.x).toBeGreaterThanOrEqual(field.x + field.width);
      expect(
        Math.abs(preset.y + preset.height / 2 - (field.y + field.height / 2)),
      ).toBeLessThanOrEqual(2);
    });
  });
}
