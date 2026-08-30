// End-to-end coverage for `defaultParams`: picking a Paragon whose item data carries
// `defaultParams` (data/db-items.json) auto-fills Role and Forte in the build editor, and
// those fields stay ordinary editable controls afterward so a "what-if" override still works.
import { test, expect } from "@playwright/test";
import {
  openBuilder,
  slotRow,
  pickerInput,
  chooseItem,
  chooseClass,
} from "./support/app";

test("choosing the Hellbringer paragon auto-fills Role and Forte", async ({
  page,
}) => {
  await openBuilder(page);
  await chooseClass(page, "warlock");
  await chooseItem(page, "options.paragon", "Hellbringer");

  await expect(pickerInput(slotRow(page, "options.role"))).toHaveValue("DPS");
  await expect(pickerInput(slotRow(page, "options.forte1"))).toHaveValue(
    "Power",
  );
  await expect(pickerInput(slotRow(page, "options.forte2a"))).toHaveValue(
    "Critical Strike",
  );
  await expect(pickerInput(slotRow(page, "options.forte2b"))).toHaveValue(
    "Awareness",
  );
});

test("Role and Forte stay editable after the auto-fill (what-if override)", async ({
  page,
}) => {
  await openBuilder(page);
  await chooseClass(page, "warlock");
  await chooseItem(page, "options.paragon", "Hellbringer");
  await expect(pickerInput(slotRow(page, "options.role"))).toHaveValue("DPS");

  await chooseItem(page, "options.forte2a", "Combat Advantage");

  await expect(pickerInput(slotRow(page, "options.forte2a"))).toHaveValue(
    "Combat Advantage",
  );
});
