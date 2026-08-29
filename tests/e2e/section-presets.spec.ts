// End-to-end coverage for a section header's "apply a preset" popover (PresetMenu.vue).
// The `options` section ships with no developer-authored presets (data/slots.json), so each
// test authors its own through the Layer editor's "Presets" tab first -- the same
// user-authored path preset-editor.spec.ts covers in more depth.
import { test, expect, type Page } from "@playwright/test";
import {
  openBuilder,
  chooseCombo,
  headerRow,
  ensureSectionExpanded,
  slotRow,
  pickerInput,
  chooseClass,
  className,
  undoButton,
} from "./support/app";
import { addLayer, layerRow } from "./support/nav";

/** Adds a "Cleared slots" row naming `slotLabel` to the preset draft on screen. */
async function addClearRow(page: Page, slotLabel: string) {
  await page.getByRole("button", { name: "Add a slot to clear" }).click();
  await chooseCombo(page.locator(".preset-clear-row").last(), slotLabel);
}

function presetMenu(page: Page, sectionId: string) {
  return headerRow(page, sectionId)
    .locator("..")
    .locator(".section-preset-btn");
}

/** Authors an Options-section preset via a fresh layer, setting one param per `[slotLabel,
 *  valueLabel]` pair, then switches back to "Build 1" with the section expanded and ready. */
async function createOptionsPreset(
  page: Page,
  label: string,
  params: [slotLabel: string, valueLabel: string][],
  clears: string[] = [],
) {
  await addLayer(page);
  await layerRow(page, "Layer 1").locator(".nav-name").click();
  await page.getByRole("button", { name: /Presets \d+/ }).click();
  await page.getByTestId("new-preset").click();

  await page.getByTestId("preset-label-input").fill(label);
  await chooseCombo(page.getByTestId("preset-section-input"), "Options");

  for (const [slotLabel, valueLabel] of params) {
    await page.getByRole("button", { name: "Add a parameter" }).click();
    const row = page.locator(".preset-row").last();
    await chooseCombo(
      row.locator(".relative", {
        has: page.getByPlaceholder("— pick a slot —"),
      }),
      slotLabel,
    );
    await chooseCombo(row.locator(".relative").last(), valueLabel);
  }

  for (const slotLabel of clears) await addClearRow(page, slotLabel);

  await page.getByRole("button", { name: "Save preset" }).click();
  await expect(page.getByText(`Saved preset "${label}"`)).toBeVisible();

  await page.getByRole("button", { name: "Build 1" }).click();
  await ensureSectionExpanded(page, "options");
}

test("applying a preset fills the slots it defines", async ({ page }) => {
  await openBuilder(page);
  await createOptionsPreset(page, "DPS (Magical)", [
    ["Role", "DPS"],
    ["Damage type", "Magical"],
  ]);

  await presetMenu(page, "options").click();
  const popover = page.locator(".preset-popover");
  await expect(popover).toBeVisible();
  await popover.getByRole("button", { name: "DPS (Magical)" }).click();

  await expect(pickerInput(slotRow(page, "options.role"))).toHaveValue("DPS");
  await expect(pickerInput(slotRow(page, "options.damageType"))).toHaveValue(
    "Magical",
  );
  await expect(popover).toBeHidden();
});

test("applying a preset leaves a slot it doesn't mention untouched", async ({
  page,
}) => {
  await openBuilder(page);
  await createOptionsPreset(page, "Healer", [["Role", "Healer"]]);

  // The "Healer" preset only sets role, not class -- set class first so we can prove it
  // survives the apply.
  await chooseClass(page, "wizard");
  await expect(pickerInput(slotRow(page, "options.class"))).toHaveValue(
    className("wizard"),
  );

  await presetMenu(page, "options").click();
  await page
    .locator(".preset-popover")
    .getByRole("button", { name: "Healer" })
    .click();

  await expect(pickerInput(slotRow(page, "options.role"))).toHaveValue(
    "Healer",
  );
  await expect(pickerInput(slotRow(page, "options.class"))).toHaveValue(
    className("wizard"),
  );
});

test("applying a preset is a single undo step", async ({ page }) => {
  await openBuilder(page);
  await createOptionsPreset(page, "DPS (Physical)", [
    ["Role", "DPS"],
    ["Damage type", "Physical"],
  ]);

  await presetMenu(page, "options").click();
  await page
    .locator(".preset-popover")
    .getByRole("button", { name: "DPS (Physical)" })
    .click();

  await expect(pickerInput(slotRow(page, "options.role"))).toHaveValue("DPS");
  await expect(pickerInput(slotRow(page, "options.damageType"))).toHaveValue(
    "Physical",
  );

  await undoButton(page).click();

  // "" is the empty choice, displayed as its own option's label, not a blank input.
  await expect(pickerInput(slotRow(page, "options.role"))).toHaveValue(
    "— none —",
  );
  await expect(pickerInput(slotRow(page, "options.damageType"))).toHaveValue(
    "— none —",
  );
});

test("applying a preset empties the slots it lists as cleared", async ({
  page,
}) => {
  await openBuilder(page);
  await createOptionsPreset(
    page,
    "Classless DPS",
    [["Role", "DPS"]],
    ["Class"],
  );

  await chooseClass(page, "wizard");
  await expect(pickerInput(slotRow(page, "options.class"))).toHaveValue(
    className("wizard"),
  );

  await presetMenu(page, "options").click();
  await page
    .locator(".preset-popover")
    .getByRole("button", { name: "Classless DPS" })
    .click();

  await expect(pickerInput(slotRow(page, "options.role"))).toHaveValue("DPS");
  // An emptied item_picker shows a blank input -- unlike a build_parameter, whose own
  // "— none —" option has a label to display.
  await expect(pickerInput(slotRow(page, "options.class"))).toHaveValue("");
});

test("clearing a slot through a preset is part of the same undo step", async ({
  page,
}) => {
  await openBuilder(page);
  await createOptionsPreset(page, "Wipe Class", [["Role", "Tank"]], ["Class"]);

  await chooseClass(page, "wizard");
  await presetMenu(page, "options").click();
  await page
    .locator(".preset-popover")
    .getByRole("button", { name: "Wipe Class" })
    .click();
  await expect(pickerInput(slotRow(page, "options.class"))).toHaveValue("");

  await undoButton(page).click();

  await expect(pickerInput(slotRow(page, "options.class"))).toHaveValue(
    className("wizard"),
  );
  await expect(pickerInput(slotRow(page, "options.role"))).toHaveValue(
    "— none —",
  );
});

// The menu's other direction: a section's live state becomes a brand-new preset draft in the
// layer editor, which the user names and saves like any other.
test("'Create new from current' opens a preset draft holding the section's state", async ({
  page,
}) => {
  await openBuilder(page);
  await ensureSectionExpanded(page, "options");
  await chooseClass(page, "wizard");
  const roleRow = slotRow(page, "options.role");
  await roleRow.getByTestId("picker-input").click();
  await roleRow.getByText("Tank", { exact: true }).click();

  await presetMenu(page, "options").click();
  await page.getByTestId("preset-create-from-current").click();

  // Landed in the layer editor's Presets tab on an unsaved draft, pre-filled from the section.
  await expect(page.getByTestId("preset-label-input")).toHaveValue(
    "Options preset",
  );
  await expect(
    pickerInput(page.getByTestId("preset-section-input")),
  ).toHaveValue("Options");
  // Params first, then item pickers -- the section's own slot order. Role is the only param
  // this build moved off its default, so it is the whole param list.
  const paramRow = page.locator(".preset-row").first();
  await expect(paramRow.getByTestId("picker-input").first()).toHaveValue(
    "Role",
  );
  await expect(paramRow.getByTestId("picker-input").last()).toHaveValue("Tank");
  // Everything the section leaves at its default came across as a cleared slot.
  await expect(page.locator(".preset-clear-row").first()).toBeVisible();

  await page.getByTestId("preset-label-input").fill("Snapshot A");
  await page.getByRole("button", { name: "Save preset" }).click();
  await expect(page.getByText('Saved preset "Snapshot A"')).toBeVisible();

  // Applying it reproduces what it was snapshotted from, on a section that has since moved
  // on: the params and picks it captured, and the slots it captured as `clears`.
  await page.getByRole("button", { name: "Build 1" }).click();
  await ensureSectionExpanded(page, "options");
  const changedRole = slotRow(page, "options.role");
  await changedRole.getByTestId("picker-input").click();
  await changedRole.getByText("Healer", { exact: true }).click();
  const damageRow = slotRow(page, "options.damageType");
  await damageRow.getByTestId("picker-input").click();
  await damageRow.getByText("Magical", { exact: true }).click();

  await presetMenu(page, "options").click();
  await page
    .locator(".preset-popover")
    .getByRole("button", { name: "Snapshot A" })
    .click();

  await expect(pickerInput(slotRow(page, "options.role"))).toHaveValue("Tank");
  await expect(pickerInput(slotRow(page, "options.class"))).toHaveValue(
    className("wizard"),
  );
  // Snapshotted while it sat at its default, so it came across as a cleared slot.
  await expect(pickerInput(slotRow(page, "options.damageType"))).toHaveValue(
    "— none —",
  );
});
