// The shared InputRow layout on an item_picker row's typed inputs: dynamic stats and stepper
// bonus inputs share one control column; checkbox inputs stay inline.
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
              bonuses: [STEPPER_BONUS_ID, CHECKBOX_BONUS_ID],
            },
          },
          bonuses: {
            [STEPPER_BONUS_ID]: {
              id: STEPPER_BONUS_ID,
              name: "Test Stepper Bonus",
              inputs: {
                stacks: {
                  type: "number",
                  min: 0,
                  max: 5,
                  default: 0,
                  label: "Stacks",
                },
              },
              grants: [{ stats: { power: 10 }, scale: { formula: "$stacks" } }],
            },
            [CHECKBOX_BONUS_ID]: {
              id: CHECKBOX_BONUS_ID,
              name: "Test Checkbox Bonus",
              inputs: {
                active: {
                  type: "boolean",
                  default: false,
                  label: "Buff active",
                },
              },
              grants: [
                {
                  when: { input: { key: "active", is: true } },
                  stats: { power: 100 },
                },
              ],
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

test("a dynamic stat and a bonus input stepper share one aligned control column", async ({
  page,
}) => {
  await openBuilder(page);
  await importRing(page);

  const row = slotRow(page, RING_SLOT);
  await expect(row.getByTestId("slot-dynamic:power")).toHaveValue("500");
  await expect(
    row.getByTestId(`bonus-input-${STEPPER_BONUS_ID}-stacks`),
  ).toHaveValue("0");

  // Bonus inputs render before dynamic stats, so the stepper row is first.
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

test("a checkbox input keeps its label as normal text on one clickable row", async ({
  page,
}) => {
  await openBuilder(page);
  await importRing(page);

  const checkbox = slotRow(page, RING_SLOT).getByTestId(
    `bonus-input-${CHECKBOX_BONUS_ID}-active`,
  );
  await expect(checkbox).toContainText("Buff active");
  await expect(checkbox).not.toHaveClass(/text-muted/);
  // Still one clickable label wrapping the box.
  await expect(checkbox.locator("input")).not.toBeChecked();
  await checkbox.click();
  await expect(checkbox.locator("input")).toBeChecked();
});
