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

const sharedSlot = {
  id: "test-shared.encore",
  label: "Test encore",
  section: "test-shared",
  type: "build_parameter" as const,
  paramType: "boolean" as const,
  path: TAKEN_PATH,
  default: false,
  sharedInput: true,
};

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

/** A bonus with a private on/off input and a row reading a shared input. */
async function openMixedInputs(page: Page) {
  await openBuilder(page);
  await importTestCatalog(page, {
    bonuses: [
      {
        id: "test-ballad",
        name: "Test Ballad",
        inputs: {
          song: { type: "boolean", default: false, label: "Sang" },
          encore: { shared: sharedSlot.id },
        },
        grants: [
          { when: { input: { key: "song", is: true } }, stats: { power: 5 } },
        ],
      },
    ],
    slots: [sharedSlot],
    sections: [
      {
        id: "test-shared",
        label: "Test Shared Inputs",
        slotIds: [sharedSlot.id],
      },
    ],
  });
  await layerRow(page, "Test catalog (imported)").locator(".nav-name").click();
  await page.getByTestId("tab-bonuses").click();
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

// An author reaches a bonus through the item carrying it more often than through the Bonuses
// list, so the same action has to be there, writing the same single layer edit.
test("a bonus opened from its item offers make shared, undone in one step", async ({
  page,
}) => {
  await openWithSingers(page);
  await layerRow(page, "Test catalog (imported)").locator(".nav-name").click();
  await page.locator(".editor-search").fill("Test Lute Ring");
  await page
    .locator(".editor-row", { hasText: "Test Lute Ring" })
    .first()
    .click();

  const card = page.getByTestId("bonus-card").first();
  await expect(card).toHaveAttribute("data-expanded", "true");
  await card.getByTestId("bonus-input-make-shared").click();

  const dialog = page.getByTestId("make-shared");
  await dialog
    .getByTestId("make-shared-other")
    .filter({ hasText: "Test Chorus" })
    .getByRole("checkbox")
    .check();
  await dialog.getByTestId("make-shared-submit").click();
  await expect(dialog).toBeHidden();
  await expect(
    card.getByTestId("bonus-input-shared").getByRole("combobox"),
  ).toHaveValue("Sang");

  // Undo demotes the input again in one step, without leaving the item.
  await undoButton(page).click();
  await expect(card.getByTestId("bonus-input-make-shared")).toBeEnabled();
  await expect(card.getByTestId("bonus-input-shared-summary")).toHaveCount(0);
});

// The offer is a row action after Add and Remove, not another field, and stays in place
// disabled until the bonus's own named input can be shared, so enabling it never shifts the
// row.
test(
  "make shared follows the add/remove pair, disabled until the input can be shared",
  { tag: "@cross-browser" },
  async ({ page }) => {
    await openMixedInputs(page);
    const rows = page.locator(".bonus-input-row");
    const own = rows.nth(0);
    const actions = own.getByTestId("repeatable-row-actions");
    const share = actions.getByTestId("bonus-input-make-shared");
    await expect(share).toBeEnabled();
    // Not among the fields: the row's rest holds the pickers and definitions.
    await expect(
      own
        .getByTestId("repeatable-row-rest")
        .getByTestId("bonus-input-make-shared"),
    ).toHaveCount(0);

    const [addBox, removeBox, shareBox] = await Promise.all(
      [
        actions.getByRole("button", { name: "Add input" }),
        actions.getByRole("button", { name: "Remove input" }),
        share,
      ].map(async (target) => (await target.boundingBox())!),
    );
    expect(addBox.x).toBeLessThan(removeBox.x);
    expect(shareBox.x).toBeGreaterThanOrEqual(removeBox.x + removeBox.width);
    const middle = (box: { y: number; height: number }) =>
      box.y + box.height / 2;
    expect(Math.abs(middle(shareBox) - middle(removeBox))).toBeLessThanOrEqual(
      2,
    );

    // A row reading a shared input defines nothing to share.
    await expect(
      rows.nth(1).getByTestId("bonus-input-make-shared"),
    ).toBeDisabled();
    await expect(
      rows.nth(1).getByTestId("bonus-input-shared-summary"),
    ).toBeVisible();

    // A row whose id is still blank keeps the button in place, disabled; naming it enables it
    // without moving the id field, the row, or the buttons.
    await page.getByRole("button", { name: "Add input" }).first().click();
    const blank = rows.last();
    const blankShare = blank
      .getByTestId("repeatable-row-actions")
      .getByTestId("bonus-input-make-shared");
    await expect(blankShare).toBeDisabled();
    const idBoxBefore = (await blank
      .getByTestId("bonus-input-id")
      .boundingBox())!;
    const rowBoxBefore = (await blank.boundingBox())!;
    await blank.getByTestId("bonus-input-id").fill("chorus");
    await expect(blankShare).toBeEnabled();
    const idBoxAfter = (await blank
      .getByTestId("bonus-input-id")
      .boundingBox())!;
    const rowBoxAfter = (await blank.boundingBox())!;
    expect(idBoxAfter.x).toBe(idBoxBefore.x);
    expect(rowBoxAfter.width).toBe(rowBoxBefore.width);
  },
);
