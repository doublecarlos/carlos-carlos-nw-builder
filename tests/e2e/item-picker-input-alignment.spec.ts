// The shared InputRow layout on an item_picker row's typed inputs: dynamic stats and
// stepper-shaped occurrence configs share one control column; checkbox configs stay inline.
import { test, expect, type Page } from "@playwright/test";
import { confirmImport, openBuilder, slotRow } from "./support/app";

const RING_SLOT = "gear.ring1";
const RING_ID = "test-input-row-ring";
const STEPPER_BONUS_ID = "test-input-row-stepper-bonus";
const CHECKBOX_BONUS_ID = "test-input-row-checkbox-bonus";

async function importRing(page: Page) {
  const fileInput = page
    .getByTestId("app-header")
    .locator('input[type="file"]');
  await fileInput.setInputFiles({
    name: "import.json",
    mimeType: "application/json",
    buffer: Buffer.from(
      JSON.stringify({
        name: "Input row test",
        choices: { [RING_SLOT]: RING_ID },
        catalog: {
          items: {
            [RING_ID]: {
              id: RING_ID,
              name: "Test Input Row Ring",
              filter: "gear_ring",
              dynamicStats: [
                {
                  stat: "power",
                  min: 0,
                  max: 1000,
                  default: 500,
                  label: "Power Bonus",
                },
              ],
              bonuses: [
                {
                  bonus: STEPPER_BONUS_ID,
                  min: 0,
                  max: 5,
                  default: 0,
                  label: "Stacks",
                },
                {
                  bonus: CHECKBOX_BONUS_ID,
                  min: 0,
                  max: 1,
                  default: 0,
                  label: "Buff active",
                },
              ],
            },
          },
          bonuses: {
            [STEPPER_BONUS_ID]: {
              id: STEPPER_BONUS_ID,
              name: "Test Stepper Bonus",
              grants: [{ stats: { power: 10 } }],
            },
            [CHECKBOX_BONUS_ID]: {
              id: CHECKBOX_BONUS_ID,
              name: "Test Checkbox Bonus",
              grants: [{ stats: { power: 100 } }],
            },
          },
          sectionPresets: {},
        },
      }),
    ),
  });
  await confirmImport(page);
  await expect(page.getByTestId("app-header")).toContainText(/imported/i);
}

test("a dynamic stat and an occurrence stepper share one aligned control column", async ({
  page,
}) => {
  await openBuilder(page);
  await importRing(page);

  const row = slotRow(page, RING_SLOT);
  await expect(row.getByTestId("slot-dynamic:power")).toHaveValue("500");
  await expect(
    row.getByTestId(`occurrence-input-${STEPPER_BONUS_ID}`),
  ).toHaveValue("0");

  // The occurrence block renders before the dynamic-stat block, so the stepper row is first.
  const rows = row.getByTestId("input-row");
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(0)).toContainText("Stacks");
  await expect(rows.nth(1)).toContainText("Power Bonus");

  const boxes = await rows.evaluateAll((els) =>
    els.map((el) => {
      const control = el.children[0].getBoundingClientRect();
      const description = el.children[1].getBoundingClientRect();
      return { controlRight: control.right, descriptionLeft: description.left };
    }),
  );
  // One fixed control column means the controls end and the descriptions begin at the same x.
  expect(Math.abs(boxes[0].controlRight - boxes[1].controlRight)).toBeLessThan(
    1,
  );
  expect(
    Math.abs(boxes[0].descriptionLeft - boxes[1].descriptionLeft),
  ).toBeLessThan(1);
});

test("a dynamic stat's limits read as a muted note after its name", async ({
  page,
}) => {
  await openBuilder(page);
  await importRing(page);

  const dynamicRow = slotRow(page, RING_SLOT).getByTestId("input-row").nth(1);
  const note = dynamicRow.locator(".text-muted");
  await expect(note).toContainText(/\(from 0 to 1,?000\)/);
});

test("a checkbox-shaped config keeps its label as normal text on one clickable row", async ({
  page,
}) => {
  await openBuilder(page);
  await importRing(page);

  const checkbox = slotRow(page, RING_SLOT).getByTestId(
    `occurrence-toggle-${CHECKBOX_BONUS_ID}`,
  );
  await expect(checkbox).toContainText("Buff active");
  await expect(checkbox).not.toHaveClass(/text-muted/);
  // Still one clickable label wrapping the box.
  await expect(checkbox.locator("input")).not.toBeChecked();
  await checkbox.click();
  await expect(checkbox.locator("input")).toBeChecked();
});
