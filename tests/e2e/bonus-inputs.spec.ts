// Bonus inputs in the build editor: a boolean input renders as a checkbox and a number input as
// a stepper on the row of the bonus's first carrier, with a note on the other copies' rows.
// Exercised through a build's own catalog overlay.
import { test, expect, type Locator, type Page } from "@playwright/test";
import {
  confirmImport,
  importText,
  openBuilder,
  slotRow,
  undoButton,
} from "./support/app";

const RING_ID = "test-input-ring";
const BONUS_ID = "test-input-bonus";

function buildWithRings(choices: Record<string, string>) {
  return {
    name: "Bonus input test",
    choices,
    catalog: {
      items: {
        [RING_ID]: {
          id: RING_ID,
          name: "Test Input Ring",
          filter: "gear_ring",
          bonuses: [BONUS_ID],
        },
      },
      bonuses: {
        [BONUS_ID]: {
          id: BONUS_ID,
          name: "Test Input Bonus",
          inputs: {
            procActive: { type: "boolean", default: false, label: "Proc" },
            stacks: {
              type: "number",
              min: 0,
              max: 5,
              default: 0,
              label: "Stacks",
            },
            share: {
              type: "number",
              min: 0,
              max: 100,
              default: 0,
              presets: [0, 50, 100],
              control: "field",
              label: "Share",
            },
          },
          grants: [
            {
              when: { input: { key: "procActive", is: true } },
              stats: { power: 1234 },
            },
            {
              when: { input: { key: "stacks", atLeast: 3 } },
              stats: { power: 5 },
            },
            {
              when: { input: { key: "share", atLeast: 50 } },
              stats: { power: 777 },
            },
          ],
        },
      },
      sectionPresets: {},
    },
  };
}

async function openWith(page: Page, choices: Record<string, string>) {
  await openBuilder(page);
  await importText(page, JSON.stringify(buildWithRings(choices)));
  await confirmImport(page);
  await expect(page.getByTestId("app-header")).toContainText(/imported/i);
}

const checkbox = (row: Locator) =>
  row.getByTestId(`bonus-input-${BONUS_ID}-procActive`).locator("input");
const stepper = (row: Locator) =>
  row.getByTestId(`bonus-input-${BONUS_ID}-stacks`);
const summary = (row: Locator) => row.getByTestId("slot-stat-summary");

test("checking a boolean input switches on the grant it gates", async ({
  page,
}) => {
  await openWith(page, { "gear.ring1": RING_ID });
  const row = slotRow(page, "gear.ring1");

  await expect(checkbox(row)).not.toBeChecked();
  await expect(summary(row)).not.toContainText("1,234");

  await checkbox(row).check();
  await expect(checkbox(row)).toBeChecked();
  await expect(summary(row)).toContainText("1,234");

  await undoButton(page).click();
  await expect(checkbox(row)).not.toBeChecked();
  await expect(summary(row)).not.toContainText("1,234");
});

test("stepping a number input past a threshold activates its grant", async ({
  page,
}) => {
  await openWith(page, { "gear.ring1": RING_ID });
  const row = slotRow(page, "gear.ring1");
  const increase = stepper(row).locator("..").getByLabel("Increase");

  await expect(stepper(row)).toHaveValue("0");
  await increase.click();
  await increase.click();
  await expect(summary(row)).not.toContainText("Power");

  await increase.click();
  await expect(stepper(row)).toHaveValue("3");
  await expect(summary(row)).toContainText("Power");
});

test("a second copy's row points to the first copy's control", async ({
  page,
}) => {
  await openWith(page, { "gear.ring1": RING_ID, "gear.ring2": RING_ID });
  const first = slotRow(page, "gear.ring1");
  const second = slotRow(page, "gear.ring2");

  await expect(checkbox(first)).toBeVisible();
  await expect(checkbox(second)).toHaveCount(0);
  await expect(
    second.getByTestId(`bonus-input-note-${BONUS_ID}-procActive`),
  ).toHaveText(/Proc: set on Ring/);
  await expect(
    first.getByTestId(`bonus-input-note-${BONUS_ID}-procActive`),
  ).toHaveCount(0);
});

test("a number input declared as a field takes typed values and presets", async ({
  page,
}) => {
  await openWith(page, { "gear.ring1": RING_ID });
  const row = slotRow(page, "gear.ring1");
  const field = row.getByTestId(`bonus-input-${BONUS_ID}-share`);
  const inputRow = row
    .getByTestId("input-row")
    .filter({ has: page.getByTestId(`bonus-input-${BONUS_ID}-share`) });

  await expect(field).toHaveValue("0");
  await expect(inputRow.getByLabel("Increase")).toHaveCount(0);

  await inputRow.getByRole("button", { name: "50" }).click();
  await expect(field).toHaveValue("50");
  await expect(summary(row)).toContainText("777");

  await field.fill("20");
  await expect(summary(row)).not.toContainText("777");
});

test("a proc left off still shows in the hover card, explained by its input", async ({
  page,
}) => {
  await openWith(page, { "gear.ring1": RING_ID });
  const row = slotRow(page, "gear.ring1");
  await row.scrollIntoViewIfNeeded();
  await row.hover();
  const card = page.getByTestId("item-card");
  await expect(card).toContainText("Test Input Bonus");
  await expect(card).toContainText("Proc is on");
});

const STACK_RING_ID = "test-stack-ring";
const STACK_BONUS_ID = "test-stack-bonus";

/** A ring whose bonus grants 20 power per stack, scaled by a stack input. */
async function openWithStacks(page: Page, stacks?: number) {
  await openBuilder(page);
  await importText(
    page,
    JSON.stringify({
      name: "Stack input test",
      choices: { "gear.ring1": STACK_RING_ID },
      ...(stacks !== undefined && {
        bonusValues: { [STACK_BONUS_ID]: { input: { stacks } } },
      }),
      catalog: {
        items: {
          [STACK_RING_ID]: {
            id: STACK_RING_ID,
            name: "Test Stack Ring",
            filter: "gear_ring",
            bonuses: [STACK_BONUS_ID],
          },
        },
        bonuses: {
          [STACK_BONUS_ID]: {
            id: STACK_BONUS_ID,
            name: "Test Stack Bonus",
            inputs: {
              stacks: {
                type: "number",
                min: 0,
                max: 5,
                default: 0,
                label: "Stacks",
              },
            },
            grants: [{ stats: { power: 20 }, scale: { formula: "$stacks" } }],
          },
        },
        sectionPresets: {},
      },
    }),
  );
  await confirmImport(page);
  await expect(page.getByTestId("app-header")).toContainText(/imported/i);
  const row = slotRow(page, "gear.ring1");
  await row.scrollIntoViewIfNeeded();
  await row.hover();
  return page.getByTestId("item-card");
}

test("a stack input at 0 previews what one stack would give", async ({
  page,
}) => {
  const card = await openWithStacks(page);
  await expect(card).toContainText("Test Stack Bonus");
  await expect(card).toContainText("Stacks > 0");
  await expect(card).toContainText("Power+20");
});

test("a stack input above 0 scales the payload", async ({ page }) => {
  const card = await openWithStacks(page, 3);
  await expect(card).toContainText("Test Stack Bonus");
  await expect(card).toContainText("Power+60");
});
