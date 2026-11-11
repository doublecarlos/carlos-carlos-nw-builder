// A section body is one grid whose tracks every row reuses through subgrid, so labels and
// controls line up across rows of every type. These run in Firefox too: subgrid is where
// engines have differed.
import { test, expect, type Locator, type Page } from "@playwright/test";
import {
  assignmentLabel,
  ensureSectionExpanded,
  openBuilder,
  pickerInput,
  slotRow,
} from "./support/app";

const PICKER_SLOT = "raceLeveling.race";
const POINT_SLOT = "raceLeveling.leveling_str";

async function box(locator: Locator) {
  const b = await locator.boundingBox();
  expect(b).not.toBeNull();
  return b!;
}

const label = (page: Page, slotId: string) =>
  slotRow(page, slotId).locator(".slot-label");

test.beforeEach(async ({ page }) => {
  await openBuilder(page);
  await ensureSectionExpanded(page, "raceLeveling");
});

test(
  "a picker row and a point row share the label column",
  { tag: "@cross-browser" },
  async ({ page }) => {
    const picker = await box(label(page, PICKER_SLOT));
    const point = await box(label(page, POINT_SLOT));
    expect(Math.abs(picker.x - point.x)).toBeLessThan(1);
    // Level would also hold with both rows collapsed onto one line.
    expect(point.y).toBeGreaterThanOrEqual(picker.y + picker.height);
  },
);

test(
  "each row's controls sit beside its label, not under it",
  { tag: "@cross-browser" },
  async ({ page }) => {
    const controls: [string, Locator][] = [
      [PICKER_SLOT, pickerInput(slotRow(page, PICKER_SLOT))],
      [
        POINT_SLOT,
        assignmentLabel(slotRow(page, POINT_SLOT), "leveling-str-3"),
      ],
    ];
    for (const [slotId, control] of controls) {
      const own = await box(label(page, slotId));
      const controlBox = await box(control);
      expect(controlBox.x, slotId).toBeGreaterThanOrEqual(own.x + own.width);
      expect(controlBox.y, slotId).toBeLessThan(own.y + own.height);
    }
  },
);
