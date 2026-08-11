// End-to-end coverage for BonusOccurrenceConfig rows (#218): an item can carry several typed
// occurrence attachments -- a 0-1 one renders as a checkbox, a wider range as a stepper, and a
// fixed (min === max) one renders no input at all. Exercised via a build's own catalog overlay
// (storage.ts's `Build.catalog`) since data/db-bonuses.json's only checkbox-shaped example
// (campfire-buff-bonus) exists for the "per-item boolean toggle, formerly proc" describe block
// below (#222) specifically, not general coverage.
import { test, expect, type Page } from "@playwright/test";
import {
  openBuilder,
  slotRow,
  occurrenceInput,
  occurrenceCheckbox,
  stepOccurrence,
} from "./support/app";

const RING_SLOT = "gear.ring1";
const RING_ID = "test-occurrence-ring";
const CHECKBOX_BONUS_ID = "test-occurrence-checkbox-bonus";
const STEPPER_BONUS_ID = "test-occurrence-stepper-bonus";
const FIXED_BONUS_ID = "test-occurrence-fixed-bonus";

async function importText(page: Page, text: string) {
  const fileInput = page
    .getByTestId("app-header")
    .locator('input[type="file"]');
  await fileInput.setInputFiles({
    name: "import.json",
    mimeType: "application/json",
    buffer: Buffer.from(text, "utf-8"),
  });
  await expect(page.getByTestId("app-header")).toContainText(/imported/i);
}

/** A build carrying one custom ring with three occurrence attachments: a checkbox-shaped one
 *  (0-1), a stepper-shaped one (0-5, tiered), and a fixed one (3-3, always active). */
function buildWithOccurrenceRing(
  occurrenceInputs: Record<string, Record<string, number>> = {},
) {
  return {
    name: "Occurrence test",
    choices: { [RING_SLOT]: RING_ID },
    occurrenceInputs,
    catalog: {
      items: {
        [RING_ID]: {
          id: RING_ID,
          name: "Test Occurrence Ring",
          filter: "gear_ring",
          bonuses: [
            { bonus: CHECKBOX_BONUS_ID, min: 0, max: 1, default: 0 },
            { bonus: STEPPER_BONUS_ID, min: 0, max: 5, default: 0 },
            { bonus: FIXED_BONUS_ID, min: 3, max: 3, default: 3 },
          ],
        },
      },
      bonuses: {
        [CHECKBOX_BONUS_ID]: {
          id: CHECKBOX_BONUS_ID,
          name: "Test Checkbox Bonus",
          grants: [{ stats: { power: 100 } }],
        },
        [STEPPER_BONUS_ID]: {
          id: STEPPER_BONUS_ID,
          name: "Test Stepper Bonus",
          grants: [
            {
              tiers: [
                {
                  bonusOccurrences: { bonus: STEPPER_BONUS_ID, atLeast: 1 },
                  stats: { power: 10 },
                },
                {
                  bonusOccurrences: { bonus: STEPPER_BONUS_ID, atLeast: 3 },
                  stats: { power: 50 },
                },
              ],
            },
          ],
        },
        [FIXED_BONUS_ID]: {
          id: FIXED_BONUS_ID,
          name: "Test Fixed Bonus",
          grants: [{ stats: { power: 999 } }],
        },
      },
      sectionPresets: {},
    },
  };
}

test.describe("BonusOccurrenceConfig rows", () => {
  test("a 0-1 config renders an unchecked checkbox, a wider range a stepper at its default, and a fixed config no input", async ({
    page,
  }) => {
    await openBuilder(page);
    await importText(page, JSON.stringify(buildWithOccurrenceRing()));

    const row = slotRow(page, RING_SLOT);
    await expect(occurrenceCheckbox(row, CHECKBOX_BONUS_ID)).toBeVisible();
    await expect(
      occurrenceCheckbox(row, CHECKBOX_BONUS_ID).locator("input"),
    ).not.toBeChecked();
    await expect(occurrenceInput(row, STEPPER_BONUS_ID)).toHaveValue("0");
    await expect(occurrenceInput(row, FIXED_BONUS_ID)).toHaveCount(0);
    await expect(occurrenceCheckbox(row, FIXED_BONUS_ID)).toHaveCount(0);
    // The fixed config's bonus is still active with no input at all.
    await expect(row).toContainText("Power");
  });

  test("checking the checkbox activates its bonus without touching the stepper's count", async ({
    page,
  }) => {
    await openBuilder(page);
    await importText(page, JSON.stringify(buildWithOccurrenceRing()));

    const row = slotRow(page, RING_SLOT);
    await occurrenceCheckbox(row, CHECKBOX_BONUS_ID).locator("input").check();

    await expect(
      occurrenceCheckbox(row, CHECKBOX_BONUS_ID).locator("input"),
    ).toBeChecked();
    await expect(occurrenceInput(row, STEPPER_BONUS_ID)).toHaveValue("0");
  });

  test("the stepper's + button increments its own count without touching the checkbox", async ({
    page,
  }) => {
    await openBuilder(page);
    await importText(page, JSON.stringify(buildWithOccurrenceRing()));

    const row = slotRow(page, RING_SLOT);
    await stepOccurrence(row, STEPPER_BONUS_ID, "increase");
    await stepOccurrence(row, STEPPER_BONUS_ID, "increase");

    await expect(occurrenceInput(row, STEPPER_BONUS_ID)).toHaveValue("2");
    await expect(
      occurrenceCheckbox(row, CHECKBOX_BONUS_ID).locator("input"),
    ).not.toBeChecked();
  });

  test("Ctrl+click on the stepper's + jumps straight to its max", async ({
    page,
  }) => {
    await openBuilder(page);
    await importText(page, JSON.stringify(buildWithOccurrenceRing()));

    const row = slotRow(page, RING_SLOT);
    await stepOccurrence(row, STEPPER_BONUS_ID, "increase", {
      modifiers: ["Control"],
    });

    await expect(occurrenceInput(row, STEPPER_BONUS_ID)).toHaveValue("5");
  });

  test("reaching the tier-3 threshold grants the higher tier's stats", async ({
    page,
  }) => {
    await openBuilder(page);
    await importText(page, JSON.stringify(buildWithOccurrenceRing()));

    const row = slotRow(page, RING_SLOT);
    await stepOccurrence(row, STEPPER_BONUS_ID, "increase");
    await stepOccurrence(row, STEPPER_BONUS_ID, "increase");
    await stepOccurrence(row, STEPPER_BONUS_ID, "increase");

    await expect(occurrenceInput(row, STEPPER_BONUS_ID)).toHaveValue("3");
    await expect(row).toContainText("Power");
  });

  test("an imported build's own occurrenceInputs entry starts the stepper at that count", async ({
    page,
  }) => {
    await openBuilder(page);
    await importText(
      page,
      JSON.stringify(
        buildWithOccurrenceRing({
          [RING_ID]: { [STEPPER_BONUS_ID]: 4 },
        }),
      ),
    );

    const row = slotRow(page, RING_SLOT);
    await expect(occurrenceInput(row, STEPPER_BONUS_ID)).toHaveValue("4");
  });
});

// #227: a BonusOccurrenceConfig's optional `label` overrides the bonus name on its own row
// (checkbox/stepper text and the compare-diff title) without renaming the bonus itself.
const LABELED_BONUS_ID = "test-occurrence-labeled-bonus";

test.describe("BonusOccurrenceConfig label override (#227)", () => {
  test("a labeled config shows its label instead of the bonus name", async ({
    page,
  }) => {
    await openBuilder(page);
    await importText(
      page,
      JSON.stringify({
        name: "Occurrence label test",
        choices: { [RING_SLOT]: RING_ID },
        catalog: {
          items: {
            [RING_ID]: {
              id: RING_ID,
              name: "Test Occurrence Ring",
              filter: "gear_ring",
              bonuses: [
                {
                  bonus: LABELED_BONUS_ID,
                  min: 0,
                  max: 5,
                  default: 0,
                  label: "Stacks",
                },
              ],
            },
          },
          bonuses: {
            [LABELED_BONUS_ID]: {
              id: LABELED_BONUS_ID,
              name: "Test Labeled Bonus",
              grants: [{ stats: { power: 10 } }],
            },
          },
          sectionPresets: {},
        },
      }),
    );

    const row = slotRow(page, RING_SLOT);
    await expect(row).toContainText("Stacks");
    await expect(row).not.toContainText("Test Labeled Bonus");
  });
});

// #222: a dedicated `proc` leaf/`build.procs` no longer exists -- a per-item on/off toggle is
// now a plain `min:0,max:1` BonusOccurrenceConfig, self-referentially gating its own bonus's
// flat grant with `bonusOccurrences: { bonus: <own id>, atLeast: 1 }` (see types.ts's own note
// on why that condition is kept even though a 0-count attachment already contributes no
// candidate either way). Mirrors data/db-bonuses.json's real `campfire-buff-bonus` migration.
const TOGGLE_BONUS_ID = "test-toggle-bonus";
const TOGGLE_RING_ID = "test-toggle-ring";

function buildWithToggleRing(
  configDefault: 0 | 1,
  occurrenceInputs: Record<string, Record<string, number>> = {},
) {
  return {
    name: "Toggle test",
    choices: { [RING_SLOT]: TOGGLE_RING_ID },
    occurrenceInputs,
    catalog: {
      items: {
        [TOGGLE_RING_ID]: {
          id: TOGGLE_RING_ID,
          name: "Test Toggle Ring",
          filter: "gear_ring",
          bonuses: [
            {
              bonus: TOGGLE_BONUS_ID,
              min: 0,
              max: 1,
              default: configDefault,
              label: "Buff active",
            },
          ],
        },
      },
      bonuses: {
        [TOGGLE_BONUS_ID]: {
          id: TOGGLE_BONUS_ID,
          name: "Test Toggle Bonus",
          grants: [
            {
              when: {
                bonusOccurrences: { bonus: TOGGLE_BONUS_ID, atLeast: 1 },
              },
              stats: { power: 500 },
            },
          ],
        },
      },
      sectionPresets: {},
    },
  };
}

test.describe("per-item boolean toggle, formerly proc (#222)", () => {
  test("a default:1 config starts checked, with its stats on the row", async ({
    page,
  }) => {
    await openBuilder(page);
    await importText(page, JSON.stringify(buildWithToggleRing(1)));

    const row = slotRow(page, RING_SLOT);
    await expect(occurrenceCheckbox(row, TOGGLE_BONUS_ID)).toContainText(
      "Buff active",
    );
    await expect(
      occurrenceCheckbox(row, TOGGLE_BONUS_ID).locator("input"),
    ).toBeChecked();
    await expect(row).toContainText("Power");
  });

  test("unchecking it turns the grant off and its stats drop off the row", async ({
    page,
  }) => {
    await openBuilder(page);
    await importText(page, JSON.stringify(buildWithToggleRing(1)));

    const row = slotRow(page, RING_SLOT);
    await occurrenceCheckbox(row, TOGGLE_BONUS_ID).locator("input").uncheck();

    await expect(
      occurrenceCheckbox(row, TOGGLE_BONUS_ID).locator("input"),
    ).not.toBeChecked();
    await expect(row).not.toContainText("Power");
  });

  test("re-checking it turns the grant back on", async ({ page }) => {
    await openBuilder(page);
    await importText(page, JSON.stringify(buildWithToggleRing(1)));

    const row = slotRow(page, RING_SLOT);
    const checkbox = occurrenceCheckbox(row, TOGGLE_BONUS_ID).locator("input");
    await checkbox.uncheck();
    await checkbox.check();

    await expect(checkbox).toBeChecked();
    await expect(row).toContainText("Power");
  });

  test("a default:0 config starts unchecked with no explicit occurrenceInputs entry", async ({
    page,
  }) => {
    await openBuilder(page);
    await importText(page, JSON.stringify(buildWithToggleRing(0)));

    const row = slotRow(page, RING_SLOT);
    await expect(
      occurrenceCheckbox(row, TOGGLE_BONUS_ID).locator("input"),
    ).not.toBeChecked();
    await expect(row).not.toContainText("Power");
  });

  test("an explicit 1 in the imported build's own occurrenceInputs overrides a default:0 config", async ({
    page,
  }) => {
    await openBuilder(page);
    await importText(
      page,
      JSON.stringify(
        buildWithToggleRing(0, { [TOGGLE_RING_ID]: { [TOGGLE_BONUS_ID]: 1 } }),
      ),
    );

    const row = slotRow(page, RING_SLOT);
    await expect(
      occurrenceCheckbox(row, TOGGLE_BONUS_ID).locator("input"),
    ).toBeChecked();
    await expect(row).toContainText("Power");
  });
});
