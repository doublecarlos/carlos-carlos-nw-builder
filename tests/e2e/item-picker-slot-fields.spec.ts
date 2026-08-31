// End-to-end coverage for the four fields an `item_picker` slot carries beyond its candidate
// selector: `quick` (render in the top strip instead of a section row), `disallowEmpty` (no
// "- empty -" row in the dropdown), `visibleWhen` (scope the row to when it is relevant), and an
// item-declared `inlineRepetition` (the pick repeats N times, with a stepper beside the picker).
//
// Each case drives a slot this spec authors itself, imported as a build-level catalogue
// overlay: an overlay re-declares a shipped slot by id, so the fixtures here own what they
// assert instead of riding on whatever data/slots.json happens to say.
import { test, expect, type Page } from "@playwright/test";
import {
  chooseItem,
  confirmImport,
  openBuilder,
  pickerInput,
  slotRow,
} from "./support/app";

const SLOT_ID = "options.enemyType";

/** Imports a build whose overlay redefines `options.enemyType` and adds the items it needs. */
async function importOverlay(
  page: Page,
  slot: Record<string, unknown>,
  items: Record<string, unknown> = {},
) {
  const fileInput = page
    .getByTestId("app-header")
    .locator('input[type="file"]');
  await fileInput.setInputFiles({
    name: "import.json",
    mimeType: "application/json",
    buffer: Buffer.from(
      JSON.stringify({
        name: "Item picker slot fields",
        catalog: {
          items,
          slots: {
            [SLOT_ID]: {
              id: SLOT_ID,
              label: "Enemy Type",
              section: "options",
              type: "item_picker",
              filter: "enemy_type",
              ...slot,
            },
          },
        },
      }),
    ),
  });
  await confirmImport(page);
  await expect(page.getByTestId("quick-options")).toBeVisible();
}

test.describe("quick", () => {
  test("a quick item_picker renders in the top strip, not in its section", async ({
    page,
  }) => {
    await openBuilder(page);
    await importOverlay(page, { quick: true });

    const quick = page.getByTestId("quick-options");
    await expect(quick.getByTestId(`quick-picker-${SLOT_ID}`)).toBeVisible();
    await expect(quick).toContainText("Enemy Type");
    // The strip renders it *instead of* its section, so there is no row duplicating it.
    await expect(slotRow(page, SLOT_ID)).toHaveCount(0);
  });

  test("picking from the strip stores the choice", async ({ page }) => {
    await openBuilder(page);
    await importOverlay(page, { quick: true });

    const picker = page
      .getByTestId("quick-options")
      .getByTestId(`quick-picker-${SLOT_ID}`);
    const input = pickerInput(picker);

    await input.click();
    await input.fill("Boss");
    await picker.getByText("Boss", { exact: true }).click();

    await expect(input).toHaveValue("Boss");
  });

  test("a non-quick item_picker keeps its section row", async ({ page }) => {
    await openBuilder(page);
    await expect(slotRow(page, SLOT_ID)).toBeVisible();
    await expect(
      page.getByTestId("quick-options").getByTestId(`quick-picker-${SLOT_ID}`),
    ).toHaveCount(0);
  });
});

test.describe("disallowEmpty", () => {
  test("an ordinary item_picker offers the empty row", async ({ page }) => {
    await openBuilder(page);
    const row = slotRow(page, SLOT_ID);
    await pickerInput(row).click();
    await expect(row.getByText("- empty -", { exact: true })).toBeVisible();
  });

  test("a disallowEmpty slot does not", async ({ page }) => {
    await openBuilder(page);
    await importOverlay(page, {
      default: "enemy-type-boss",
      disallowEmpty: true,
    });

    const row = slotRow(page, SLOT_ID);
    await row.scrollIntoViewIfNeeded();
    await pickerInput(row).click();
    // The candidates are still all there -- only the "no value" row is gone.
    await expect(row.getByText("Boss", { exact: true })).toBeVisible();
    await expect(row.getByText("- empty -", { exact: true })).toHaveCount(0);
  });
});

test.describe("visibleWhen", () => {
  test("scopes an item_picker's row to when its condition holds", async ({
    page,
  }) => {
    await openBuilder(page);
    await importOverlay(page, {
      visibleWhen: { toggle: "combat" },
    });

    const combat = page
      .getByTestId("quick-options")
      .getByLabel("Combat", { exact: true });

    // The shipped `combat` toggle starts on, so the scoped row is rendered to begin with.
    await expect(slotRow(page, SLOT_ID)).toBeVisible();
    await combat.uncheck();
    await expect(slotRow(page, SLOT_ID)).toHaveCount(0);
    await combat.check();
    await expect(slotRow(page, SLOT_ID)).toBeVisible();
  });

  test("hiding the row does not unequip what is in it", async ({ page }) => {
    await openBuilder(page);
    await importOverlay(page, { visibleWhen: { toggle: "combat" } });

    const combat = page
      .getByTestId("quick-options")
      .getByLabel("Combat", { exact: true });
    await chooseItem(page, SLOT_ID, "Boss");

    await combat.uncheck();
    await expect(slotRow(page, SLOT_ID)).toHaveCount(0);

    // Still the same pick when the row comes back -- hiding is a display filter, nothing more.
    await combat.check();
    await expect(pickerInput(slotRow(page, SLOT_ID))).toHaveValue("Boss");
  });
});

test.describe("inline repetition", () => {
  const REPEATER_ID = "test-repeating-enemy";

  /** An `enemy_type` candidate that declares an `inlineRepetition`, so picking it grows a
   *  stepper. The slot itself says nothing about repetition -- the item's own config does. */
  const repeater = {
    [REPEATER_ID]: {
      id: REPEATER_ID,
      name: "Test Repeating Enemy",
      filter: "enemy_type",
      power: 100,
      inlineRepetition: { min: 0, max: 4, default: 1 },
    },
  };

  test("a pick with no config has no stepper", async ({ page }) => {
    await openBuilder(page);
    await importOverlay(page, {}, repeater);
    await chooseItem(page, SLOT_ID, "Boss");

    await expect(
      slotRow(page, SLOT_ID).getByTestId(/^repetition-input-/),
    ).toHaveCount(0);
  });

  test("a pick that declares one starts at its default and steps", async ({
    page,
  }) => {
    await openBuilder(page);
    await importOverlay(page, {}, repeater);
    await chooseItem(page, SLOT_ID, "Test Repeating Enemy");

    const row = slotRow(page, SLOT_ID);
    const input = row.getByTestId(`repetition-input-${REPEATER_ID}`);
    await expect(input).toHaveValue("1");

    await row.getByLabel("Increase").click();
    await expect(input).toHaveValue("2");
  });

  test("the count survives, and the stepper goes away when the pick changes", async ({
    page,
  }) => {
    await openBuilder(page);
    await importOverlay(page, {}, repeater);
    await chooseItem(page, SLOT_ID, "Test Repeating Enemy");

    const row = slotRow(page, SLOT_ID);
    const input = row.getByTestId(`repetition-input-${REPEATER_ID}`);
    await input.fill("3");
    await input.blur();
    await expect(input).toHaveValue("3");

    await chooseItem(page, SLOT_ID, "Boss");
    await expect(row.getByTestId(/^repetition-input-/)).toHaveCount(0);
  });
});
