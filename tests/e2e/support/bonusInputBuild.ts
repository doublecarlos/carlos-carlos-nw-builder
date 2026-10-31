// A build whose ring carries a bonus with two number inputs, one with presets, so its build row
// shows bonus input controls without leaning on shipped data.
import type { Page } from "@playwright/test";
import { confirmImport, importText, openBuilder, slotRow } from "./app";

export const RING_ID = "test-input-ring";
export const BONUS_ID = "test-input-bonus";

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

/** Opens the builder on the imported build and returns the ring's row. */
export async function openWithBonusInputs(page: Page) {
  await openBuilder(page);
  await importText(page, JSON.stringify(build));
  await confirmImport(page);
  return slotRow(page, "gear.ring1");
}
