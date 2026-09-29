// A section preset's `bonusValues`: "Create new from current" carries the settings and inputs
// of the bonuses the section's items carry, the preset form edits them, and applying the
// preset writes them back.
import { test, expect } from "@playwright/test";
import {
  confirmImport,
  ensureSectionExpanded,
  headerRow,
  importText,
  openBuilder,
  slotRow,
} from "./support/app";

const BUILD_NAME = "Preset bonus settings";
const RING_SLOT = "gear.ring1";
const RING_ID = "test-preset-settings-ring";
const BONUS_ID = "test-preset-settings-bonus";

const build = {
  name: BUILD_NAME,
  choices: { [RING_SLOT]: RING_ID },
  bonusValues: { [BONUS_ID]: { stat: { defense: 120 }, input: { stacks: 2 } } },
  catalog: {
    items: {
      [RING_ID]: {
        id: RING_ID,
        name: "Test Preset Settings Ring",
        filter: "gear_ring",
        bonuses: [BONUS_ID],
      },
    },
    bonuses: {
      [BONUS_ID]: {
        id: BONUS_ID,
        name: "Test Preset Settings Bonus",
        inputs: {
          stacks: {
            type: "number",
            min: 0,
            max: 5,
            default: 0,
            label: "Stacks",
          },
        },
        grants: [
          {
            dynamicStats: [{ stat: "defense", min: 0, max: 200, default: 40 }],
          },
          {
            when: { input: { key: "stacks", atLeast: 1 } },
            stats: { power: 5 },
          },
        ],
      },
    },
    sectionPresets: {},
  },
};

test("a preset snapshots, edits and applies a carried bonus's setting", async ({
  page,
}) => {
  await openBuilder(page);
  await importText(page, JSON.stringify(build));
  await confirmImport(page);

  await ensureSectionExpanded(page, "gear");
  const presetMenu = headerRow(page, "gear")
    .locator("..")
    .locator(".section-preset-btn");
  await presetMenu.click();
  await page.getByTestId("preset-create-from-current").click();

  const setting = page.getByTestId(`preset-bonus-stat-${BONUS_ID}-defense`);
  await expect(setting).toHaveValue("120");
  await setting.fill("150");
  await page.getByTestId("preset-label-input").fill("Bonus snapshot");
  await page.getByRole("button", { name: "Save preset" }).click();
  await expect(page.getByText('Saved preset "Bonus snapshot"')).toBeVisible();

  await page
    .getByTestId("nav-builds-list")
    .getByRole("button", { name: BUILD_NAME })
    .click();
  await ensureSectionExpanded(page, "gear");
  const input = slotRow(page, RING_SLOT).getByTestId("slot-dynamic:defense");
  await expect(input).toHaveValue("120");

  await presetMenu.click();
  await page
    .locator(".preset-popover")
    .getByRole("button", { name: "Bonus snapshot", exact: true })
    .click();
  await expect(input).toHaveValue("150");
});

test("a preset snapshots, edits and applies a carried bonus's input", async ({
  page,
}) => {
  await openBuilder(page);
  await importText(page, JSON.stringify(build));
  await confirmImport(page);

  await ensureSectionExpanded(page, "gear");
  const presetMenu = headerRow(page, "gear")
    .locator("..")
    .locator(".section-preset-btn");
  await presetMenu.click();
  await page.getByTestId("preset-create-from-current").click();

  const setting = page.getByTestId(`preset-bonus-input-${BONUS_ID}-stacks`);
  await expect(setting).toHaveValue("2");
  await setting.fill("4");
  await page.getByTestId("preset-label-input").fill("Input snapshot");
  await page.getByRole("button", { name: "Save preset" }).click();
  await expect(page.getByText('Saved preset "Input snapshot"')).toBeVisible();

  await page
    .getByTestId("nav-builds-list")
    .getByRole("button", { name: BUILD_NAME })
    .click();
  await ensureSectionExpanded(page, "gear");
  const stepper = slotRow(page, RING_SLOT).getByTestId(
    `bonus-input-${BONUS_ID}-stacks`,
  );
  await expect(stepper).toHaveValue("2");

  await presetMenu.click();
  await page
    .locator(".preset-popover")
    .getByRole("button", { name: "Input snapshot", exact: true })
    .click();
  await expect(stepper).toHaveValue("4");
});
