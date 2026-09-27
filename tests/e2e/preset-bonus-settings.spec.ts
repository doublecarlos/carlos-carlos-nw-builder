// A section preset's `bonusValues`: "Create new from current" carries the settings of the
// bonuses the section's items carry, the preset form edits them, and applying the preset
// writes them back.
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
  bonusValues: { [BONUS_ID]: { stat: { defense: 120 } } },
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
        grants: [
          {
            dynamicStats: [{ stat: "defense", min: 0, max: 200, default: 40 }],
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
