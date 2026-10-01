// A build saved before occurrence counts were retired opens with those counts on the bonus
// inputs that replaced them, rather than falling back to the inputs' defaults.
import { test, expect } from "@playwright/test";
import {
  bonusInputControl,
  confirmImport,
  importText,
  openBuilder,
  slotRow,
} from "./support/app";

const legacyBuild = {
  name: "Legacy occurrence build",
  choices: {
    "gear.shirt": "m33-cracked-stormbind-tunic-shirt",
    "enchantments.combatDefense": "shattered-resolve",
  },
  occurrenceInputs: {
    "m33-cracked-stormbind-tunic-shirt": { "m33-bloodletting": 0 },
    "shattered-resolve": { "shattered-resolve-stacks": 2 },
  },
};

test("legacy occurrence counts open on their bonus inputs", async ({
  page,
}) => {
  await openBuilder(page);
  await importText(page, JSON.stringify(legacyBuild));
  await confirmImport(page);
  await expect(page.getByTestId("app-header")).toContainText(/imported/i);

  const proc = bonusInputControl(
    slotRow(page, "gear.shirt"),
    "m33-bloodletting",
    "active",
  );
  await expect(proc.locator("input")).not.toBeChecked();

  const stacks = bonusInputControl(
    slotRow(page, "enchantments.combatDefense"),
    "shattered-resolve-stacks",
    "stacks",
  );
  await expect(stacks).toHaveValue("2");
});
