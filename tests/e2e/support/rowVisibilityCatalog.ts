// A test catalog whose rows gate on the combat toggle, for checks on what follows a hidden
// field: text and separator rows, and sections left with no field.
import { expect, type Page } from "@playwright/test";
import { ensureSectionExpanded, openBuilder } from "./app";
import { importTestCatalog } from "./testCatalog";
import type { Slot } from "../../../src/types";

export const SECTION = "test-rows";
export const GATED_SECTION = "test-gated";
export const RING = "Test Row Ring";
const inCombat = { toggle: "combat" };

const picker = (
  id: string,
  label: string,
  section = SECTION,
  gated = false,
): Slot => ({
  id,
  label,
  section,
  type: "item_picker",
  filter: "gear_ring",
  ...(gated ? { availableWhen: inCombat } : {}),
});

export function combatToggle(page: Page) {
  return page
    .getByTestId("quick-options")
    .getByLabel("Combat", { exact: true });
}

/** One section of three groups: a note over a combat-only picker, a plain picker, and another
 *  combat-only picker. A second section holds only a note and a combat-only picker. Starts in
 *  combat, so every row is there. */
export async function openWithRows(page: Page) {
  await openBuilder(page);
  await importTestCatalog(page, {
    items: [{ id: "test-row-ring", name: RING, filter: "gear_ring" }],
    slots: [
      { id: `${SECTION}.note`, section: SECTION, type: "text", text: "Note" },
      picker(`${SECTION}.first`, "Test First", SECTION, true),
      { id: `${SECTION}.sep1`, section: SECTION, type: "separator" },
      picker(`${SECTION}.plain`, "Test Plain"),
      { id: `${SECTION}.sep2`, section: SECTION, type: "separator" },
      picker(`${SECTION}.last`, "Test Last", SECTION, true),
      {
        id: `${GATED_SECTION}.note`,
        section: GATED_SECTION,
        type: "text",
        text: "Gated note",
      },
      picker(`${GATED_SECTION}.only`, "Test Only", GATED_SECTION, true),
    ],
    sections: [
      {
        id: SECTION,
        label: "Test Rows",
        slotIds: ["note", "first", "sep1", "plain", "sep2", "last"].map(
          (id) => `${SECTION}.${id}`,
        ),
      },
      {
        id: GATED_SECTION,
        label: "Test Gated",
        slotIds: [`${GATED_SECTION}.note`, `${GATED_SECTION}.only`],
      },
    ],
  });
  await combatToggle(page).check();
  await expect(combatToggle(page)).toBeChecked();
  await ensureSectionExpanded(page, SECTION);
}
