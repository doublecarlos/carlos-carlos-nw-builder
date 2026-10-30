// A bonus input's control on a phone build row (BuildInputControl through InputRow): the label
// reads first, the control sits left-aligned under it rather than hanging right-aligned in the
// desktop's leading column, and any presets take the line below the control. The quick options
// strip lays its params out the same way.
import { test, expect, type Page } from "@playwright/test";
import {
  confirmImport,
  openBuilder,
  importText,
  slotRow,
} from "../support/app";
import { MIN_SUPPORTED_WIDTH } from "../support/viewport";

const RING_ID = "test-input-ring";
const BONUS_ID = "test-input-bonus";

const build = {
  name: "Bonus input row test",
  choices: { "gear.ring1": RING_ID },
  catalog: {
    items: {
      [RING_ID]: {
        id: RING_ID,
        name: "Test Input Ring",
        filter: "gear_ring",
        bonuses: [BONUS_ID],
      },
    },
    bonuses: {
      [BONUS_ID]: {
        id: BONUS_ID,
        name: "Test Input Bonus",
        inputs: {
          stacks: {
            type: "number",
            min: 0,
            max: 5,
            default: 0,
            label: "Stacks of a long-running effect",
          },
          share: {
            type: "number",
            min: 0,
            max: 100,
            default: 0,
            presets: [0, 50, 100],
            control: "field",
            label: "Share",
          },
        },
        grants: [{ stats: { power: 5 } }],
      },
    },
    sectionPresets: {},
  },
};

async function openWithInputs(page: Page) {
  await openBuilder(page);
  await importText(page, JSON.stringify(build));
  await confirmImport(page);
  return slotRow(page, "gear.ring1");
}

for (const width of [MIN_SUPPORTED_WIDTH, 412]) {
  test.describe(`at ${width}px`, () => {
    test.use({ viewport: { width, height: 800 } });

    test("an input's label comes first, its control left-aligned under it", async ({
      page,
    }) => {
      const row = await openWithInputs(page);
      for (const key of ["stacks", "share"]) {
        const inputRow = row
          .getByTestId("input-row")
          .filter({ has: page.getByTestId(`bonus-input-${BONUS_ID}-${key}`) });
        const control = inputRow.getByTestId("input-row-control");
        const description = inputRow.getByTestId("input-row-description");
        await expect(control).toBeVisible();

        const rowBox = (await inputRow.boundingBox())!;
        const controlBox = (await control.boundingBox())!;
        const descriptionBox = (await description.boundingBox())!;
        // The label line, then the control under it, both from the row's left edge.
        expect(descriptionBox.y + descriptionBox.height).toBeLessThanOrEqual(
          controlBox.y + 1,
        );
        expect(Math.abs(descriptionBox.x - rowBox.x)).toBeLessThanOrEqual(1);
        expect(Math.abs(controlBox.x - rowBox.x)).toBeLessThanOrEqual(1);
        // Nothing in the control spills past the row.
        const content = await control.evaluate((el) => el.scrollWidth);
        expect(content).toBeLessThanOrEqual(controlBox.width + 1);
      }
    });

    test("presets sit on their own line under the control", async ({
      page,
    }) => {
      const row = await openWithInputs(page);
      const inputRow = row
        .getByTestId("input-row")
        .filter({ has: page.getByTestId(`bonus-input-${BONUS_ID}-share`) });
      const description = inputRow.getByTestId("input-row-description");
      const control = inputRow.getByTestId("input-row-control");
      const presets = inputRow.getByTestId("input-row-presets");
      await expect(presets.getByRole("button")).toHaveText(["0", "50", "100"]);
      await expect(description).not.toContainText("50");
      await expect(description).toContainText("(from 0 to 100)");

      const rowBox = (await inputRow.boundingBox())!;
      const controlBox = (await control.boundingBox())!;
      const presetsBox = (await presets.boundingBox())!;
      expect(controlBox.y + controlBox.height).toBeLessThanOrEqual(
        presetsBox.y + 1,
      );
      expect(Math.abs(presetsBox.x - rowBox.x)).toBeLessThanOrEqual(1);

      await presets.getByRole("button", { name: "50" }).tap();
      await expect(
        page.getByTestId(`bonus-input-${BONUS_ID}-share`),
      ).toHaveValue("50");
    });

    test("a quick option reads label, then field, then presets", async ({
      page,
    }) => {
      await openBuilder(page);
      const param = page.getByTestId("quick-param-options.duration");
      const label = param.getByText("Duration (s)");
      const field = param.getByRole("spinbutton");
      const presets = param.getByRole("button", { name: "30" });
      const labelBox = (await label.boundingBox())!;
      const fieldBox = (await field.boundingBox())!;
      const presetBox = (await presets.boundingBox())!;
      expect(labelBox.y + labelBox.height).toBeLessThanOrEqual(fieldBox.y + 1);
      expect(fieldBox.y + fieldBox.height).toBeLessThanOrEqual(presetBox.y + 1);
      expect(Math.abs(fieldBox.x - labelBox.x)).toBeLessThanOrEqual(1);
    });
  });
}
