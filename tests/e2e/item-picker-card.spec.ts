// The item card beside an open picker: it follows the highlighted candidate, by keyboard and by
// pointer, previews the candidate's bonuses as if it were picked, and stays read-only.
import { test, expect, type Locator, type Page } from "@playwright/test";
import {
  chooseItem,
  openBuilder,
  pickerInput,
  slotRow,
  togglePickerOption,
} from "./support/app";
import { addLayer, layerRow } from "./support/nav";
import { openSlotsTab } from "./support/layerEditor";
import { importTestCatalog } from "./support/testCatalog";

// Carries its own bonus, active by default (see item-picker-bonus-preview.spec.ts).
const HEAD_ITEM_WITH_BONUS = "M29 Enchanted Depthweave Cap";

const card = (scope: Locator) =>
  scope.getByTestId("picker-aside").getByTestId("item-card");

const option = (scope: Locator, name: string) =>
  scope
    .getByTestId("picker-menu")
    .getByTestId("picker-option")
    .filter({ hasText: name });

async function openHeadPicker(page: Page) {
  await openBuilder(page);
  const row = slotRow(page, "gear.head");
  await pickerInput(row).click();
  return row;
}

test("the card follows the keyboard highlight", async ({ page }) => {
  const row = await openHeadPicker(page);
  const highlighted = row
    .getByTestId("picker-menu")
    .locator("[data-highlighted]")
    .getByTestId("picker-option-name");

  await pickerInput(row).press("ArrowDown");
  await expect(card(row).getByTestId("item-card-name")).toHaveText(
    (await highlighted.textContent()) ?? "",
  );
  await pickerInput(row).press("ArrowDown");
  await expect(card(row).getByTestId("item-card-name")).toHaveText(
    (await highlighted.textContent()) ?? "",
  );
});

test("hovering a candidate shows its card with its bonuses, read-only", async ({
  page,
}) => {
  const row = await openHeadPicker(page);
  await option(row, HEAD_ITEM_WITH_BONUS).hover();

  await expect(card(row).getByTestId("item-card-name")).toHaveText(
    HEAD_ITEM_WITH_BONUS,
  );
  await expect(card(row).getByTestId("item-card-grant").first()).toBeVisible();
  await expect(card(row).getByRole("button")).toHaveCount(0);
});

test("the empty row shows no card", async ({ page }) => {
  const row = await openHeadPicker(page);
  await option(row, HEAD_ITEM_WITH_BONUS).hover();
  await expect(card(row)).toBeVisible();

  await option(row, "- empty -").hover();
  await expect(card(row)).toHaveCount(0);
});

test("pressing on the card keeps the picker open, Escape closes both", async ({
  page,
}) => {
  const row = await openHeadPicker(page);
  await option(row, HEAD_ITEM_WITH_BONUS).hover();
  await card(row).click();
  await expect(row.getByTestId("picker-menu")).toBeVisible();
  await expect(card(row)).toBeVisible();

  await pickerInput(row).press("Escape");
  await expect(row.getByTestId("picker-menu")).toHaveCount(0);
  await expect(card(row)).toHaveCount(0);
});

test("the lens option turns the card off", async ({ page }) => {
  await openBuilder(page);
  await togglePickerOption(page, "showCard");
  const row = slotRow(page, "gear.head");
  await pickerInput(row).click();
  await option(row, HEAD_ITEM_WITH_BONUS).hover();
  await expect(option(row, HEAD_ITEM_WITH_BONUS)).toHaveAttribute(
    "data-highlighted",
    "true",
  );
  await expect(card(row)).toHaveCount(0);
});

test("the class picker shows a card too", async ({ page }) => {
  await openBuilder(page);
  const row = slotRow(page, "options.class");
  await pickerInput(row).click();
  await pickerInput(row).press("ArrowDown");
  await expect(card(row).getByTestId("item-card-name")).toBeVisible();
});

test("opening the picker highlights the equipped item", async ({ page }) => {
  await openBuilder(page);
  await chooseItem(page, "gear.head", HEAD_ITEM_WITH_BONUS);
  const row = slotRow(page, "gear.head");
  await pickerInput(row).click();

  await expect(
    row
      .getByTestId("picker-menu")
      .locator("[data-highlighted]")
      .getByTestId("picker-option-name"),
  ).toHaveText(HEAD_ITEM_WITH_BONUS);
  await expect(card(row).getByTestId("item-card-name")).toHaveText(
    HEAD_ITEM_WITH_BONUS,
  );
});

test("a picker with no build to resolve against shows the card without bonuses", async ({
  page,
}) => {
  await openBuilder(page);
  await addLayer(page);
  await layerRow(page, "Layer 1").locator(".nav-name").click();
  await openSlotsTab(page);
  await page.locator(".editor-search").fill("Head");
  await page.locator(".editor-row", { hasText: "Head" }).first().click();

  const field = page.getByTestId("slot-item-default-input");
  await pickerInput(field).click();
  await option(field, HEAD_ITEM_WITH_BONUS).hover();
  await expect(card(field).getByTestId("item-card-name")).toHaveText(
    HEAD_ITEM_WITH_BONUS,
  );
  await expect(card(field).getByTestId("item-card-grant")).toHaveCount(0);
});

test("a candidate's step ladder reads the build with the candidate picked", async ({
  page,
}) => {
  const RING_ID = "test-self-ladder-ring";
  const BONUS_ID = "test-self-ladder-bonus";
  const NAME = "Test Self Ladder Ring";
  await openBuilder(page);
  // The bonus doubles while its own ring is equipped, so a ladder read against the build
  // without the candidate would show half of what picking it gives.
  await importTestCatalog(page, {
    name: "Self ladder test",
    choices: { "gear.ring1": "" },
    items: [
      {
        id: RING_ID,
        name: NAME,
        filter: "gear_ring",
        bonuses: [BONUS_ID],
      },
    ],
    bonuses: [
      {
        id: BONUS_ID,
        name: "Test Self Ladder Bonus",
        inputs: {
          stacks: {
            type: "number",
            min: 0,
            max: 2,
            default: 1,
            label: "Stacks",
          },
        },
        formulas: {
          self: { formula: `min(equipped("${RING_ID}"), 1)` },
        },
        grants: [
          {
            stats: { power: 100 },
            scale: {
              formula: "$stacks * (1 + $self)",
              steps: { over: "$stacks", min: 0, max: 2, step: 1 },
            },
          },
        ],
      },
    ],
  });

  const row = slotRow(page, "gear.ring1");
  await row.scrollIntoViewIfNeeded();
  await pickerInput(row).click();
  await pickerInput(row).fill(NAME);
  await pickerInput(row).press("ArrowDown");

  const ladder = card(row).getByTestId("item-card-ladder");
  await expect(ladder).toContainText("Stacks 2:");
  await expect(ladder).toContainText("Power+400");
});
