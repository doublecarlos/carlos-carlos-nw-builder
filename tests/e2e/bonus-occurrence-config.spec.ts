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

  // #256: a bonus reachable only through this item's own 0-valued config shows in the hover
  // card and sidebar -- inactive, explained by its own input's current value -- rather than
  // being indistinguishable from an item that doesn't carry the bonus at all.
  test("a 0-valued stepper's bonus still shows in the item's hover card and the sidebar's Bonuses list", async ({
    page,
  }) => {
    await openBuilder(page);
    await importText(page, JSON.stringify(buildWithOccurrenceRing()));

    const row = slotRow(page, RING_SLOT);
    await row.scrollIntoViewIfNeeded();
    await row.hover();
    const card = page.locator(".fixed.z-40");
    await expect(card).toContainText("Test Stepper Bonus");
    // The same ring's checkbox-shaped config (also default 0) has its own zero-occurrence
    // note too -- match this one specifically by its text, not just the testid.
    await expect(
      card
        .getByTestId("item-card-bonus-zero-occurrence")
        .filter({ hasText: "Test Stepper Bonus: 0 on this item" }),
    ).toBeVisible();
    await page.mouse.move(0, 0);
    await expect(card).toBeHidden();

    await page.getByRole("button", { name: /^Bonuses/ }).click();
    const sidebar = page.locator("aside.sidebar");
    await sidebar
      .getByPlaceholder("Filter by bonus, id or item…")
      .fill("Test Stepper Bonus");
    await expect(sidebar.getByText("Test Stepper Bonus")).toBeVisible();
    await expect(sidebar.getByText("Nothing matches that filter.")).toHaveCount(
      0,
    );
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

  // #256: same as the stepper case above, for the checkbox-shaped config -- the item's hover
  // card explains the off state via its own label, not the generic condition-unmet wording.
  test("an unchecked config's bonus still shows in the item's hover card, explained by its own input", async ({
    page,
  }) => {
    await openBuilder(page);
    await importText(page, JSON.stringify(buildWithToggleRing(0)));

    const row = slotRow(page, RING_SLOT);
    await row.scrollIntoViewIfNeeded();
    await row.hover();
    const card = page.locator(".fixed.z-40");
    await expect(card).toContainText("Test Toggle Bonus");
    await expect(
      card.getByTestId("item-card-bonus-zero-occurrence"),
    ).toContainText("Buff active: off on this item");
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

// A `stacking: "perSource"` bonus with an unconditional grant (no `when` at all -- e.g. the
// shipped "Shattered Resolve Stacks") has nothing to naturally fail its own gate at 0 real
// occurrences, unlike every other config in this file's self-referential `bonusOccurrences`
// gate. At 0 stacks its preview must read as what *one* stack would give, muted, not as a flat
// (and previously wrong: multiplied by 0 stacks) number.
const STACKING_BONUS_ID = "test-stacking-bonus";
const STACKING_RING_ID = "test-stacking-ring";

test.describe("a simple perSource-stacking bonus's zero-stack preview", () => {
  test("reads as what one stack would give, muted", async ({ page }) => {
    await openBuilder(page);
    await importText(
      page,
      JSON.stringify({
        name: "Stacking preview test",
        choices: { [RING_SLOT]: STACKING_RING_ID },
        catalog: {
          items: {
            [STACKING_RING_ID]: {
              id: STACKING_RING_ID,
              name: "Test Stacking Ring",
              filter: "gear_ring",
              bonuses: [
                {
                  bonus: STACKING_BONUS_ID,
                  min: 0,
                  max: 5,
                  default: 0,
                  label: "Stacks",
                },
              ],
            },
          },
          bonuses: {
            [STACKING_BONUS_ID]: {
              id: STACKING_BONUS_ID,
              name: "Test Stacking Bonus",
              stacking: "perSource",
              maxStacks: 5,
              grants: [{ stats: { power: 20 } }],
            },
          },
          sectionPresets: {},
        },
      }),
    );

    const row = slotRow(page, RING_SLOT);
    await row.scrollIntoViewIfNeeded();
    await row.hover();
    const card = page.locator(".fixed.z-40");
    await expect(card).toContainText("Test Stacking Bonus");
    await expect(card).toContainText("Stacks: 0 on this item");
    await expect(card).toContainText("each stack would give:");
    // The raw per-stack value (20), not 0 (5 stacks × 0) and not a total.
    await expect(card).toContainText("Power+20");
  });

  test("once stacks are set, shows the totaled, unmuted value instead", async ({
    page,
  }) => {
    await openBuilder(page);
    await importText(
      page,
      JSON.stringify({
        name: "Stacking preview test",
        choices: { [RING_SLOT]: STACKING_RING_ID },
        occurrenceInputs: { [STACKING_RING_ID]: { [STACKING_BONUS_ID]: 3 } },
        catalog: {
          items: {
            [STACKING_RING_ID]: {
              id: STACKING_RING_ID,
              name: "Test Stacking Ring",
              filter: "gear_ring",
              bonuses: [
                {
                  bonus: STACKING_BONUS_ID,
                  min: 0,
                  max: 5,
                  default: 0,
                  label: "Stacks",
                },
              ],
            },
          },
          bonuses: {
            [STACKING_BONUS_ID]: {
              id: STACKING_BONUS_ID,
              name: "Test Stacking Bonus",
              stacking: "perSource",
              maxStacks: 5,
              grants: [{ stats: { power: 20 } }],
            },
          },
          sectionPresets: {},
        },
      }),
    );

    const row = slotRow(page, RING_SLOT);
    await row.scrollIntoViewIfNeeded();
    await row.hover();
    const card = page.locator(".fixed.z-40");
    await expect(card).toContainText("Test Stacking Bonus");
    await expect(card).toContainText("total, from 3 stacking sources");
    await expect(card).not.toContainText("each stack would give:");
    // 3 stacks × 20 = 60, the totaled (not per-stack) value.
    await expect(card).toContainText("Power+60");
  });
});
