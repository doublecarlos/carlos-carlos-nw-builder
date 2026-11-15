// "Make shared" turns a bonus's own input into a shared input that other bonuses can read too.
// Builds keep what the player set: the stored value moves to the new shared input.
import { test, expect, type Page } from "@playwright/test";
import {
  bonusInputControl,
  ensureSectionExpanded,
  openBuilder,
  pickerMenu,
  slotRow,
  undoButton,
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

const TAKEN_PATH = "shared.test.encore";

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
    // A parameter whose path a new shared input must stay clear of.
    slots: [
      {
        id: "test-options.encore",
        label: "Test encore",
        section: "test-options",
        type: "build_parameter",
        paramType: "boolean",
        path: TAKEN_PATH,
        default: false,
      },
    ],
    sections: [
      {
        id: "test-options",
        label: "Test Options",
        slotIds: ["test-options.encore"],
      },
    ],
    choices: { "gear.ring1": "test-lute", "gear.ring2": "test-drum" },
  });
  await ensureSectionExpanded(page, "gear");
}

const lute = (page: Page) =>
  bonusInputControl(slotRow(page, "gear.ring1"), "test-ballad", "song");
const drum = (page: Page) =>
  bonusInputControl(slotRow(page, "gear.ring2"), "test-chorus", "song");

test("making an input shared shares it with the picked bonuses and keeps the build's value", async ({
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
  await page.getByTestId("bonus-input-make-shared").click();

  const dialog = page.getByTestId("make-shared");
  await dialog
    .getByTestId("make-shared-other")
    .filter({ hasText: "Test Chorus" })
    .getByRole("checkbox")
    .check();
  await dialog.getByTestId("make-shared-submit").click();
  await expect(dialog).toBeHidden();
  // The form now reads the input from the new shared input.
  await expect(
    page.getByTestId("bonus-input-shared").getByRole("combobox"),
  ).toHaveValue("Sang");

  await buildRow(page, "Test catalog").locator(".nav-name").click();
  await ensureSectionExpanded(page, "gear");
  // The lute's value moved to the shared input, which the drum now reads too.
  await expect(lute(page)).toBeChecked();
  await expect(drum(page)).toBeChecked();
  await drum(page).uncheck();
  await expect(lute(page)).not.toBeChecked();
  await drum(page).check();

  // Undoing the layer edit demotes the input: each reader gets the shared value as its own.
  await layerRow(page, "Test catalog (imported)").locator(".nav-name").click();
  await expect(page.getByTestId("bonus-input-shared-summary")).toBeVisible();
  await undoButton(page).click();
  await expect(page.getByTestId("bonus-input-make-shared")).toBeVisible();
  await buildRow(page, "Test catalog").locator(".nav-name").click();
  await ensureSectionExpanded(page, "gear");
  await expect(lute(page)).toBeChecked();
  await expect(drum(page)).toBeChecked();
  // Private again: setting one leaves the other alone.
  await lute(page).uncheck();
  await expect(drum(page)).toBeChecked();
});

async function openBalladForm(page: Page) {
  await openWithSingers(page);
  await layerRow(page, "Test catalog (imported)").locator(".nav-name").click();
  await page.getByRole("button", { name: /Bonuses \d+/ }).click();
  await page.locator(".editor-search").fill("Test Ballad");
  await page.locator(".editor-row", { hasText: "Test Ballad" }).first().click();
}

// The author picks where the shared input sits under the naming convention. A typed id that is
// taken is reported, not renamed, so the id written is always the one typed.
test("the new shared input's id can be edited, and a taken one is refused", async ({
  page,
}) => {
  await openBalladForm(page);
  await page.getByTestId("bonus-input-make-shared").click();
  const dialog = page.getByTestId("make-shared");
  const id = dialog.getByTestId("make-shared-id");
  const submit = dialog.getByTestId("make-shared-submit");
  await expect(id).toHaveValue(/^shared\./);

  // The error is the field's description, so a screen reader hears why.
  await id.fill(TAKEN_PATH);
  await expect(id).toHaveAccessibleDescription(/already/);
  await expect(id).toHaveAttribute("aria-invalid", "true");
  await expect(submit).toBeDisabled();

  await id.fill("shared.scenario.song");
  await expect(dialog.getByTestId("form-field-error")).toBeHidden();
  await expect(id).not.toHaveAttribute("aria-invalid");
  await submit.click();
  await expect(dialog).toBeHidden();

  const picker = page.getByTestId("bonus-input-shared");
  await picker.getByRole("combobox").click();
  await expect(
    pickerMenu(picker)
      .getByRole("option", { name: /Sang/ })
      .getByTestId("option-row-id"),
  ).toHaveText("shared.scenario.song");
});
