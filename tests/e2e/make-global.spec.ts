// "Make global" turns a bonus's own input into a global input that other bonuses can read too.
// Builds keep what the player set: the stored value moves to the new global input.
import { test, expect, type Page } from "@playwright/test";
import {
  bonusInputControl,
  ensureSectionExpanded,
  openBuilder,
  slotRow,
} from "./support/app";
import { buildRow, layerRow } from "./support/nav";
import { importTestCatalog } from "./support/testCatalog";
import type { Bonus } from "../../src/types";

/** A bonus with a private on/off input named `song`. */
const singer = (id: string, name: string): Bonus => ({
  id,
  name,
  inputs: { song: { type: "boolean", default: false, label: "Sang" } },
  grants: [{ when: { input: { key: "song", is: true } }, stats: { power: 5 } }],
});

async function openWithSingers(page: Page) {
  await openBuilder(page);
  await importTestCatalog(page, {
    items: [
      {
        id: "test-lute",
        name: "Test Lute Ring",
        filter: "gear_ring",
        bonuses: ["test-ballad"],
      },
      {
        id: "test-drum",
        name: "Test Drum Ring",
        filter: "gear_ring",
        bonuses: ["test-chorus"],
      },
    ],
    bonuses: [
      singer("test-ballad", "Test Ballad"),
      singer("test-chorus", "Test Chorus"),
    ],
    choices: { "gear.ring1": "test-lute", "gear.ring2": "test-drum" },
  });
  await ensureSectionExpanded(page, "gear");
}

const lute = (page: Page) =>
  bonusInputControl(slotRow(page, "gear.ring1"), "test-ballad", "song");
const drum = (page: Page) =>
  bonusInputControl(slotRow(page, "gear.ring2"), "test-chorus", "song");

test("making an input global shares it with the picked bonuses and keeps the build's value", async ({
  page,
}) => {
  await openWithSingers(page);
  await lute(page).check();
  // Two private inputs: setting one leaves the other alone.
  await expect(drum(page)).not.toBeChecked();

  await layerRow(page, "Test catalog (imported)").locator(".nav-name").click();
  await page.getByRole("button", { name: /Bonuses \d+/ }).click();
  await page.locator(".editor-search").fill("Test Ballad");
  await page.locator(".editor-row", { hasText: "Test Ballad" }).first().click();
  await page.getByTestId("bonus-input-make-global").click();

  const dialog = page.getByTestId("make-global");
  await dialog
    .getByTestId("make-global-other")
    .filter({ hasText: "Test Chorus" })
    .getByRole("checkbox")
    .check();
  await dialog.getByTestId("make-global-submit").click();
  await expect(dialog).toBeHidden();
  // The form now reads the input from the new global input.
  await expect(page.getByTestId("bonus-input-global-summary")).toContainText(
    "Sang",
  );

  await buildRow(page, "Test catalog").locator(".nav-name").click();
  await ensureSectionExpanded(page, "gear");
  // The lute's value moved to the global input, which the drum now reads too.
  await expect(lute(page)).toBeChecked();
  await expect(drum(page)).toBeChecked();
  await drum(page).uncheck();
  await expect(lute(page)).not.toBeChecked();
});
