// Text and separator rows follow the fields around them, whatever hides those fields: an
// unavailable slot, the slot filter or a compare-only row. A section with no field left on
// screen hides. Driven through a test catalog whose slots gate on the combat toggle.
import { test, expect, type Page } from "@playwright/test";
import {
  openBuilder,
  ensureSectionExpanded,
  headerRow,
  slotRow,
  chooseItem,
  chooseCombo,
  slotFilterInput,
} from "./support/app";
import { importTestCatalog } from "./support/testCatalog";
import type { Slot } from "../../src/types";

const SECTION = "test-rows";
const GATED_SECTION = "test-gated";
const RING = "Test Row Ring";
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

/** One section of three groups: a note over a combat-only picker, a plain picker, and another
 *  combat-only picker. A second section holds only a note and a combat-only picker. */
async function openWithRows(page: Page) {
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
  await ensureSectionExpanded(page, SECTION);
}

const row = (page: Page, kind: "text" | "separator", id: string) =>
  page.getByTestId(`${kind}:${SECTION}.${id}`);

function combatToggle(page: Page) {
  return page
    .getByTestId("quick-options")
    .getByLabel("Combat", { exact: true });
}

test("a group whose fields are unavailable takes its note and separator along", async ({
  page,
}) => {
  await openWithRows(page);
  // The shipped combat toggle starts on, so every row is there.
  await expect(row(page, "text", "note")).toBeVisible();
  await expect(row(page, "separator", "sep1")).toBeVisible();
  await expect(row(page, "separator", "sep2")).toBeVisible();

  await combatToggle(page).uncheck();
  await expect(slotRow(page, `${SECTION}.plain`)).toBeVisible();
  // No orphaned note, and no divider with nothing on one side of it.
  await expect(row(page, "text", "note")).toBeHidden();
  await expect(row(page, "separator", "sep1")).toBeHidden();
  await expect(row(page, "separator", "sep2")).toBeHidden();
});

test("a section whose fields are all unavailable hides", async ({ page }) => {
  await openWithRows(page);
  await expect(headerRow(page, GATED_SECTION)).toBeVisible();

  // Its note alone does not keep it on screen.
  await combatToggle(page).uncheck();
  await expect(headerRow(page, GATED_SECTION)).toBeHidden();
  await expect(headerRow(page, SECTION)).toBeVisible();
});

test("the filter keeps a matching field's note and drops separators with nothing beyond", async ({
  page,
}) => {
  await openWithRows(page);
  await slotFilterInput(page).fill("Test First");
  await expect(slotRow(page, `${SECTION}.first`)).toBeVisible();
  await expect(row(page, "text", "note")).toBeVisible();
  await expect(row(page, "separator", "sep1")).toBeHidden();
  // Text and separator rows are not matches.
  await expect(page.getByTestId("slot-filter-count")).toHaveText("1 match");

  await slotFilterInput(page).fill("Test Plain");
  await expect(row(page, "text", "note")).toBeHidden();
  await expect(row(page, "separator", "sep1")).toBeHidden();
  await expect(row(page, "separator", "sep2")).toBeHidden();
});

test("a compare-only row keeps its group's separator", async ({ page }) => {
  await openWithRows(page);
  await chooseItem(page, `${SECTION}.last`, RING);

  // A second build out of combat, compared against the one holding the ring.
  await page.getByTestId("nav-add-build").click();
  await ensureSectionExpanded(page, SECTION);
  await combatToggle(page).uncheck();
  await expect(row(page, "separator", "sep2")).toBeHidden();
  await chooseCombo(page.locator(".compare-select"), "Test catalog");
  await page.getByRole("checkbox", { name: "Highlight changes" }).check();

  await expect(page.getByTestId(`compare-only:${SECTION}.last`)).toBeVisible();
  await expect(row(page, "separator", "sep2")).toBeVisible();
});
