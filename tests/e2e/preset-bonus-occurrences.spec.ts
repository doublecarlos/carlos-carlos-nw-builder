// End-to-end coverage for a section preset's `occurrences` field: a preset can seed an item's
// BonusOccurrenceConfig count(s) the same way it seeds params/choices/values/assignments.
// Both halves are covered -- authoring the count in the Layer editor's preset form, and
// applying an already-authored preset from the build's own "Preset..." menu.
//
// Neither test depends on the shipped catalogue happening to carry a suitable item: each
// brings its own, through whichever catalogue layer its half of the flow can see (an imported
// build's own overlay below, a layer-authored item further down).
import { test, expect, type Page } from "@playwright/test";
import {
  openBuilder,
  chooseCombo,
  headerRow,
  ensureSectionExpanded,
  slotRow,
  occurrenceInput,
  pickerInput,
} from "./support/app";
import { addLayer, layerRow } from "./support/nav";

const RING_SLOT = "gear.ring1";
const RING_ID = "test-preset-occurrence-ring";
const RING_NAME = "Test Preset Ring";
const STACK_BONUS_ID = "test-preset-occurrence-bonus";
const PRESET_LABEL = "Stacked Ring";

/** A build whose catalogue carries one ring with a 0-5 occurrence config, plus whatever extra
 *  overlay entries a test needs (e.g. the preset under test). */
function buildWithRing(extra: Record<string, unknown> = {}) {
  return {
    name: "Preset occurrence test",
    catalog: {
      items: {
        [RING_ID]: {
          id: RING_ID,
          name: RING_NAME,
          filter: "gear_ring",
          bonuses: [
            {
              bonus: STACK_BONUS_ID,
              min: 0,
              max: 5,
              default: 0,
              label: "Stacks",
            },
          ],
        },
      },
      bonuses: {
        [STACK_BONUS_ID]: {
          id: STACK_BONUS_ID,
          name: "Test Stack Bonus",
          grants: [{ stats: { power: 10 } }],
        },
      },
      sectionPresets: {},
      ...extra,
    },
  };
}

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

async function applyGearPreset(page: Page, label: string) {
  await ensureSectionExpanded(page, "gear");
  await headerRow(page, "gear")
    .locator("..")
    .locator(".section-preset-btn")
    .click();
  const popover = page.locator(".preset-popover");
  await expect(popover).toBeVisible();
  // Exact: the row's "update from current" button names the preset in its own label too.
  await popover.getByRole("button", { name: label, exact: true }).click();
}

test("applying a preset seeds the item's occurrence count alongside its choice", async ({
  page,
}) => {
  await openBuilder(page);
  await importText(
    page,
    JSON.stringify(
      buildWithRing({
        sectionPresets: {
          "stacked-ring": {
            id: "stacked-ring",
            label: PRESET_LABEL,
            section: "gear",
            choices: { [RING_SLOT]: RING_ID },
            occurrences: { [RING_ID]: { [STACK_BONUS_ID]: 4 } },
          },
        },
      }),
    ),
  );

  await applyGearPreset(page, PRESET_LABEL);

  const row = slotRow(page, RING_SLOT);
  await expect(pickerInput(row)).toHaveValue(RING_NAME);
  await expect(occurrenceInput(row, STACK_BONUS_ID)).toHaveValue("4");
  // The count is a real one, not just a displayed number: the bonus it gates is now granting.
  await expect(row).toContainText("Power");
});

// The authoring half works off a layer-authored item instead of the build catalog above: the
// preset form lives in the Layer editor, where the item has to come from a catalogue layer to
// be pickable at all. Both the item id and the bonus id are generated on save, so the controls
// below are located structurally (by testid prefix) rather than by those ids.
const AUTHORED_ITEM = "ZZZ Preset Occurrence Ring";
const AUTHORED_BONUS = "ZZZ Preset Occurrence Bonus";

/** Creates a gear_ring item carrying one 0-5 occurrence config, saved into the open layer. */
async function authorRingWithOccurrenceConfig(page: Page) {
  await page.getByTestId("new-item").click();
  await page.getByTestId("item-name-input").fill(AUTHORED_ITEM);
  await page.getByTestId("item-filter-input").fill("gear_ring");

  await page.getByLabel("Add bonus").click();
  await page.getByTestId("bonus-name-input").fill(AUTHORED_BONUS);
  await page.getByRole("button", { name: "Save bonus" }).click();

  const configRow = page.getByTestId("occurrence-config-row");
  await configRow.getByTestId("add-occurrence-config").click();
  const fields = configRow.getByTestId("occurrence-config-fields");
  const bounds = fields.locator('input[type="number"]');
  await bounds.nth(0).fill("0");
  await bounds.nth(1).fill("5");
  await bounds.nth(2).fill("0");
  await fields.getByTestId("occurrence-config-label-input").fill("Stacks");

  await page.getByRole("button", { name: "Save item" }).click();
}

test("a count typed into the preset form is what applying the preset writes", async ({
  page,
}) => {
  await openBuilder(page);
  await addLayer(page);
  await layerRow(page, "Layer 1").locator(".nav-name").click();
  await authorRingWithOccurrenceConfig(page);

  // Author the preset: pick the ring in an item row, then set the occurrence stepper that
  // appears for the config it carries.
  await page.getByRole("button", { name: /Presets \d+/ }).click();
  await page.getByTestId("new-preset").click();
  await page.getByTestId("preset-label-input").fill(PRESET_LABEL);
  await chooseCombo(page.getByTestId("preset-section-input"), "Gear");

  await page.getByRole("button", { name: "Add an item slot" }).click();
  const presetRow = page.locator(".preset-row").first();
  await chooseCombo(
    presetRow.locator(".relative", {
      has: page.getByPlaceholder("- pick a slot -"),
    }),
    "Ring 1",
  );
  // The row's second picker is the ItemPicker itself -- typed to filter, same as a build
  // slot's own picker (support/app.ts's `chooseItem`).
  const itemPicker = presetRow.getByTestId("picker-input").last();
  await itemPicker.click();
  await itemPicker.fill(AUTHORED_ITEM);
  await presetRow.getByText(AUTHORED_ITEM, { exact: true }).click();

  await expect(presetRow).toContainText("Stacks");
  await presetRow
    .locator('[data-testid^="preset-occurrence-"][data-testid*="-input-"]')
    .fill("3");
  await page.getByRole("button", { name: "Save preset" }).click();
  await expect(page.getByText(`Saved preset "${PRESET_LABEL}"`)).toBeVisible();

  // Back in the build, applying it brings both the choice and the authored count with it.
  await page.getByRole("button", { name: "Build 1" }).click();
  await applyGearPreset(page, PRESET_LABEL);

  const row = slotRow(page, RING_SLOT);
  await expect(pickerInput(row)).toHaveValue(AUTHORED_ITEM);
  await expect(row.locator('[data-testid^="occurrence-input-"]')).toHaveValue(
    "3",
  );
});
