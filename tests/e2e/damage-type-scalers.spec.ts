// End-to-end coverage for the damage-type share parameters: the three controls sit in the
// options section, a share moves the stat panel through a grant that names it in `scaledBy`,
// and the hover card of a scaled item explains the number at every share, including the 0
// every new build starts from.
import { test, expect, type Page } from "@playwright/test";
import {
  openBuilder,
  ensureSectionExpanded,
  slotRow,
  chooseItem,
  hoverForCard,
} from "./support/app";

/** Shipped with one grant, 5% outgoing damage (mult) scaled by the encounter share, and
 *  nothing else that touches that stat, so the panel's row reads straight off the share. */
const COLLAR = "Sturdy Crescent Collar";

const SHARES = [
  ["options.encounterDamage", "Encounter Damage"],
  ["options.atWillDamage", "At-will Damage"],
  ["options.dailyDamage", "Daily Damage"],
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

async function equipCollar(page: Page) {
  await ensureSectionExpanded(page, "options");
  await ensureSectionExpanded(page, "mounts");
  await chooseItem(page, "mounts.sturdyCollar", COLLAR);
}

test("the three share controls render in the options section, starting at 0", async ({
  page,
}) => {
  await openBuilder(page);
  await ensureSectionExpanded(page, "options");
  for (const [slotId, label] of SHARES) {
    const row = slotRow(page, slotId);
    await expect(row).toContainText(label);
    await expect(row.locator("input")).toHaveValue("0");
  }
});

test("setting the encounter share moves a stat the collar's grant feeds", async ({
  page,
}) => {
  await openBuilder(page);
  await equipCollar(page);

  // At the default share of 0 the collar's damage grant contributes nothing.
  await expect(statValue(page, "outgoing_damage_mult")).toHaveText("0.00%");

  // 5% x 40% encounters.
  await setShare(page, "options.encounterDamage", 40);
  await expect(statValue(page, "outgoing_damage_mult")).toHaveText("2.00%");

  // The other shares are not this grant's, so they leave it alone.
  await setShare(page, "options.atWillDamage", 50);
  await expect(statValue(page, "outgoing_damage_mult")).toHaveText("2.00%");
});

test("the hover card explains a scaled grant at 0 and once the share is set", async ({
  page,
}) => {
  await openBuilder(page);
  await equipCollar(page);

  const label = slotRow(page, "mounts.sturdyCollar").locator(".slot-label");
  const card = page.locator(".itemcard");

  await hoverForCard(page, label);
  await expect(card).toBeVisible();
  // The row stays, and says which share is missing rather than looking broken.
  const unset = card.getByTestId("grant-scale-unset");
  await expect(unset).toContainText("Encounter Damage");
  await expect(unset).toContainText("share is unset");
  await expect(card.getByTestId("stat-row-note")).toContainText(
    "5.00% x 0.00% Encounter Damage",
  );

  await page.mouse.move(0, 0);
  await setShare(page, "options.encounterDamage", 40);
  await hoverForCard(page, label);
  await expect(card).toBeVisible();
  await expect(card.getByTestId("grant-scale-unset")).toHaveCount(0);
  await expect(card.getByTestId("stat-row-note")).toContainText(
    "5.00% x 40.00% Encounter Damage",
  );
  await expect(card).toContainText("+2.00%");
});
