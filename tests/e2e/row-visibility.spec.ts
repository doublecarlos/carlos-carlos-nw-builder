// Text and separator rows follow the fields around them, whatever hides those fields: an
// unavailable slot, the slot filter or a compare-only row. A section with no field left on
// screen hides. Driven through a test catalog whose slots gate on the combat toggle.
import { test, expect, type Page } from "@playwright/test";
import {
  ensureSectionExpanded,
  headerRow,
  slotRow,
  chooseItem,
  chooseCombo,
  slotFilterInput,
} from "./support/app";
import {
  GATED_SECTION,
  RING,
  SECTION,
  combatToggle,
  openWithRows,
} from "./support/rowVisibilityCatalog";

const row = (page: Page, kind: "text" | "separator", id: string) =>
  page.getByTestId(`${kind}:${SECTION}.${id}`);

test("a group whose fields are unavailable takes its note and separator along", async ({
  page,
}) => {
  await openWithRows(page);
  // In combat, every row is there.
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
  await expect(page.getByTestId("slot-filter-count")).toHaveText(/^\s*1\b/);

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
