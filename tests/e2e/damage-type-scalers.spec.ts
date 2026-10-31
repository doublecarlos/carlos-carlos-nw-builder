// End-to-end coverage for the damage-type share parameters: the three controls sit in their
// own scalers section, a share moves the stat panel through a grant scaled by it, and the hover
// card of a scaled item explains the number at every share, including the 0 every new build
// starts from, with the scaler's name linking to its row.
import { test, expect, type Page } from "@playwright/test";
import {
  openBuilder,
  ensureSectionExpanded,
  slotRow,
  chooseItem,
  cursorRow,
  hoverForCard,
} from "./support/app";
import {
  TEST_HEAD_BONUS,
  TEST_HEAD_ITEM_WITH_BONUS,
} from "./support/headItems";
import { importTestCatalog } from "./support/testCatalog";

const COLLAR_SLOT = "mounts.sturdyCollar";
const COLLAR = "Test Scaled Collar";
const COLLAR_BONUS = "test-scaled-bonus";
const STACKING_COLLAR = "Test Stacking Collar";

/** Scaled grants on items for the collar slot. The scaled collar has one grant, 5% outgoing
 *  damage (mult) scaled by the encounter share, and nothing else in the build touches that
 *  stat, so the panel's row reads straight off the share. The stacking collar adds a base and
 *  a per-stack grant, both scaled by the same share. */
async function openWithScaledItems(page: Page) {
  await openBuilder(page);
  await importTestCatalog(page, {
    items: [
      {
        id: "test-scaled-collar",
        name: COLLAR,
        filter: "sturdy_collar",
        bonuses: [COLLAR_BONUS],
      },
      {
        id: "test-stacking-collar",
        name: STACKING_COLLAR,
        filter: "sturdy_collar",
        bonuses: ["test-stacking-bonus"],
      },
      TEST_HEAD_ITEM_WITH_BONUS,
    ],
    bonuses: [
      {
        id: COLLAR_BONUS,
        name: "Test Scaled Bonus",
        grants: [
          {
            stats: { outgoing_damage_mult: 0.05 },
            scale: { formula: 'scaler("scalers.encounterDamage")' },
          },
        ],
      },
      {
        id: "test-stacking-bonus",
        name: "Test Stacking Bonus",
        inputs: {
          stacks: {
            type: "number",
            label: "Stacks",
            min: 0,
            max: 5,
            default: 5,
          },
        },
        grants: [
          {
            stats: { outgoing_damage: 0.2 },
            scale: { formula: 'scaler("scalers.encounterDamage")' },
          },
          {
            stats: { outgoing_damage: 0.02 },
            scale: {
              formula: '$stacks * scaler("scalers.encounterDamage")',
              steps: { over: "$stacks", min: 1, max: 5, step: 1 },
            },
          },
        ],
      },
      TEST_HEAD_BONUS,
    ],
  });
}

const SHARES = [
  ["scalers.encounterDamage", "Encounter damage"],
  ["scalers.atWillDamage", "At-will damage"],
  ["scalers.dailyDamage", "Daily damage"],
] as const;

function statValue(page: Page, key: string) {
  return page
    .locator(`[data-stat-row="${key}"]`)
    .getByTestId("stat-value")
    .first();
}

/** Types a percentage into a `paramType: percent` row (the input reads and writes percent
 *  units, not the decimal the build stores). */
async function setShare(page: Page, slotId: string, percent: number) {
  const input = slotRow(page, slotId).locator("input");
  await input.click();
  await input.fill(String(percent));
  await input.blur();
}

async function equipCollar(page: Page, name = COLLAR) {
  await ensureSectionExpanded(page, "scalers");
  await ensureSectionExpanded(page, "mounts");
  await chooseItem(page, COLLAR_SLOT, name);
}

test("the three share controls render in the scalers section, starting at 0", async ({
  page,
}) => {
  await openBuilder(page);
  await ensureSectionExpanded(page, "scalers");
  for (const [slotId, label] of SHARES) {
    const row = slotRow(page, slotId);
    await expect(row).toContainText(label);
    await expect(row.locator("input")).toHaveValue("0");
  }
});

test("setting the encounter share moves a stat the collar's grant feeds", async ({
  page,
}) => {
  await openWithScaledItems(page);
  await equipCollar(page);

  // At the default share of 0 the collar's damage grant contributes nothing.
  await expect(statValue(page, "outgoing_damage_mult")).toHaveText("0.00%");

  // 5% x 40% encounters.
  await setShare(page, "scalers.encounterDamage", 40);
  await expect(statValue(page, "outgoing_damage_mult")).toHaveText("2.00%");

  // The other shares are not this grant's, so they leave it alone.
  await setShare(page, "scalers.atWillDamage", 50);
  await expect(statValue(page, "outgoing_damage_mult")).toHaveText("2.00%");
});

test("the hover card explains a scaled grant at 0 and once the share is set", async ({
  page,
}) => {
  await openWithScaledItems(page);
  await equipCollar(page);

  const label = slotRow(page, COLLAR_SLOT).locator(".slot-label");
  const card = page.locator(".itemcard");

  await hoverForCard(page, label);
  await expect(card).toBeVisible();
  // At 0 the grant is inactive: the row previews the real value, its note the unset share.
  await expect(
    card.getByTestId("item-card-grant").getByTestId("stat-row"),
  ).toContainText("+5.00%");
  await expect(card.getByTestId("stat-row-note")).toContainText(
    "5.00% x 0.00% Encounter damage",
  );

  await page.mouse.move(0, 0);
  await setShare(page, "scalers.encounterDamage", 40);
  await hoverForCard(page, label);
  await expect(card).toBeVisible();
  await expect(card.getByTestId("stat-row-note")).toContainText(
    "5.00% x 40.00% Encounter damage",
  );
  await expect(card).toContainText("+2.00%");
});

test("the scaler's name in a note links to its parameter row", async ({
  page,
}) => {
  await openWithScaledItems(page);
  await equipCollar(page);

  const label = slotRow(page, COLLAR_SLOT).locator(".slot-label");
  const card = page.locator(".itemcard");
  await hoverForCard(page, label);
  await expect(card).toBeVisible();

  const link = card.getByTestId("stat-row-note-link");
  await expect(link).toHaveText("Encounter damage");
  await link.click();
  // The card gives way to the jump, which parks the cursor on the share's own row.
  await expect(card).toBeHidden();
  await expect(cursorRow(page)).toHaveAttribute(
    "data-cursor-key",
    "slot:scalers.encounterDamage",
  );
});

test("the inspector explains the collar's scale and links the scaler to its row", async ({
  page,
}) => {
  await openWithScaledItems(page);
  await equipCollar(page);
  await setShare(page, "scalers.encounterDamage", 40);
  await page.getByRole("button", { name: /Bonuses/ }).click();

  const entry = page.getByTestId(`bonus-entry-${COLLAR_BONUS}`);
  await entry.getByRole("button").first().click();
  const line = entry.getByTestId("bonus-formula-line");
  await expect(line).toContainText("Scale (Encounter damage):");
  await expect(line).toContainText("= 0.4");

  await line
    .getByRole("button", { name: "Encounter damage", exact: true })
    .click();
  await expect(cursorRow(page)).toHaveAttribute(
    "data-cursor-key",
    "slot:scalers.encounterDamage",
  );
});

test("a scaled bonus shows its base at the share and a step ladder per stack", async ({
  page,
}) => {
  await openWithScaledItems(page);
  await equipCollar(page, STACKING_COLLAR);
  await setShare(page, "scalers.encounterDamage", 40);

  const label = slotRow(page, COLLAR_SLOT).locator(".slot-label");
  const card = page.locator(".itemcard");
  await hoverForCard(page, label);
  await expect(card).toBeVisible();

  // The base 20% is written at 40% of that, noting its real value.
  const [base, perStack] = await card.getByTestId("item-card-grant").all();
  await expect(base).toContainText("+8.00%");
  await expect(base.getByTestId("stat-row-note")).toHaveText(
    "20.00% x 40.00% Encounter damage",
  );
  // 2% per stack, laddered from 1 to 5 stacks, each rung at the share.
  const ladder = perStack.getByTestId("item-card-ladder");
  await expect(ladder).toContainText("Stacks 1:");
  await expect(ladder).toContainText("+0.80%");
  await expect(ladder).toContainText("Stacks 5:");
  await expect(ladder).toContainText("+4.00%");
  // Stacks default to the full five, so the panel carries 8% and 4%.
  await expect(statValue(page, "outgoing_damage")).toHaveText("12.00%");
});

test("the bonus inspector breaks a scaled bonus down under its own heading", async ({
  page,
}) => {
  await openWithScaledItems(page);
  await equipCollar(page);
  await ensureSectionExpanded(page, "gear");
  await chooseItem(page, "gear.head", TEST_HEAD_ITEM_WITH_BONUS.name);
  await setShare(page, "scalers.encounterDamage", 40);

  await page.getByRole("button", { name: /^Bonuses/ }).click();
  const sidebar = page.getByTestId("details-sidebar");

  // The collar's grant is scaled: the summed payload gets the real value and share under it.
  const collar = sidebar.getByTestId(`bonus-entry-${COLLAR_BONUS}`);
  await collar.locator("button.group").click();
  await expect(collar).toContainText("Detailed scaling:");
  const scaled = collar.getByTestId("bonus-grant-scale");
  await expect(scaled).toHaveCount(1);
  await expect(scaled.getByTestId("bonus-grant-stat-row")).toContainText(
    "+2.00%",
  );
  await expect(scaled.getByTestId("bonus-grant-stat-row-note")).toHaveText(
    "5.00% x 40.00% Encounter damage",
  );

  // The cap's grant is not, so the breakdown and its heading stay away.
  const cap = sidebar.getByTestId(`bonus-entry-${TEST_HEAD_BONUS.id}`);
  await cap.locator("button.group").click();
  await expect(cap.getByTestId("bonus-stat-row")).toHaveCount(1);
  await expect(cap).not.toContainText("Detailed scaling:");
  await expect(cap.getByTestId("bonus-grant-scale")).toHaveCount(0);
});
