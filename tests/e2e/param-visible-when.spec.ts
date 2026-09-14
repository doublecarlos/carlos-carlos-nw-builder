// End-to-end coverage for `BuildParameterSlot.visibleWhen`: it scopes a param's row to
// when it is relevant. Driven through the shipped scoping this shipped with -- the three forte
// params are hidden until a paragon is equipped -- since that is the only path a user has to
// flip one today (authoring a slot is slot-overlay.spec.ts's own coverage).
import { test, expect } from "@playwright/test";
import {
  openBuilder,
  slotRow,
  pickerInput,
  chooseItem,
  chooseClass,
} from "./support/app";

const FORTE_SLOTS = ["options.forte1", "options.forte2a", "options.forte2b"];

/** Clears an item_picker slot through its own "- empty -" option, the way a user would. */
async function clearSlot(
  page: import("@playwright/test").Page,
  slotId: string,
) {
  const row = slotRow(page, slotId);
  await pickerInput(row).click();
  await row.getByText("- empty -", { exact: true }).click();
}

test("a scoped param appears only while its condition holds", async ({
  page,
}) => {
  await openBuilder(page);

  // Fresh build: no paragon, so no forte rows -- even though the Options section is open.
  await expect(slotRow(page, "options.class")).toBeVisible();
  for (const slotId of FORTE_SLOTS) {
    await expect(slotRow(page, slotId)).toHaveCount(0);
  }

  await chooseClass(page, "warlock");
  await chooseItem(page, "options.paragon", "Hellbringer");
  for (const slotId of FORTE_SLOTS) {
    await expect(slotRow(page, slotId)).toBeVisible();
  }

  await clearSlot(page, "options.paragon");
  for (const slotId of FORTE_SLOTS) {
    await expect(slotRow(page, slotId)).toHaveCount(0);
  }
});

test("an unscoped param is untouched, in its section and in the quick strip", async ({
  page,
}) => {
  await openBuilder(page);
  const quick = page.getByTestId("quick-options");
  await expect(quick).toContainText("Duration (s)");
  await expect(slotRow(page, "options.magnitude")).toBeVisible();

  await chooseClass(page, "warlock");
  await chooseItem(page, "options.paragon", "Hellbringer");

  await expect(quick).toContainText("Duration (s)");
  await expect(slotRow(page, "options.magnitude")).toBeVisible();
});
