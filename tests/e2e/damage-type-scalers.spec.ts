// End-to-end coverage for the damage-type share parameters: the three controls sit in their
// own scalers section, a share moves the stat panel through a grant that names it in
// `scaledBy`, and the hover card of a scaled item explains the number at every share, including
// the 0 every new build starts from, with the scaler's name linking to its row.
import { test, expect, type Page } from "@playwright/test";
import {
  openBuilder,
  ensureSectionExpanded,
  slotRow,
  chooseItem,
  chooseClass,
  cursorRow,
  hoverForCard,
} from "./support/app";

/** Shipped with one grant, 5% outgoing damage (mult) scaled by the encounter share, and
 *  nothing else that touches that stat, so the panel's row reads straight off the share. */
const COLLAR = "Sturdy Crescent Collar";

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

async function equipCollar(page: Page) {
  await ensureSectionExpanded(page, "scalers");
  await ensureSectionExpanded(page, "mounts");
  await chooseItem(page, "mounts.sturdyCollar", COLLAR);
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
  await openBuilder(page);
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
  await openBuilder(page);
  await equipCollar(page);

  const label = slotRow(page, "mounts.sturdyCollar").locator(".slot-label");
  const card = page.locator(".itemcard");

  await hoverForCard(page, label);
  await expect(card).toBeVisible();
  // The row stays at 0, and its note shows the unset share rather than looking broken.
  await expect(
    card.getByTestId("item-card-grant").getByTestId("stat-row"),
  ).toContainText("0.00%");
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
  await openBuilder(page);
  await equipCollar(page);

  const label = slotRow(page, "mounts.sturdyCollar").locator(".slot-label");
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

test("a scaled ladder shows every rung at the share, each noting its real value", async ({
  page,
}) => {
  await openBuilder(page);
  await ensureSectionExpanded(page, "options");
  await chooseClass(page, "warlock");
  await chooseItem(page, "options.paragon", "Hellbringer");
  await ensureSectionExpanded(page, "classStuff");
  await chooseItem(page, "classStuff.feat3", "Risky Investment");
  await ensureSectionExpanded(page, "scalers");
  await setShare(page, "scalers.encounterDamage", 40);

  const label = slotRow(page, "classStuff.feat3").locator(".slot-label");
  const card = page.locator(".itemcard");
  await hoverForCard(page, label);
  await expect(card).toBeVisible();

  // Five rungs, 22% to 30% before the share, all written at 40% of that.
  const rows = card.getByTestId("stat-row");
  await expect(rows.getByTestId("stat-row-note")).toHaveCount(5);
  await expect(rows.nth(0)).toContainText("+8.80%");
  await expect(rows.nth(0).getByTestId("stat-row-note")).toHaveText(
    "22.00% x 40.00% Encounter damage",
  );
  await expect(rows.nth(4)).toContainText("+12.00%");
  await expect(rows.nth(4).getByTestId("stat-row-note")).toHaveText(
    "30.00% x 40.00% Encounter damage",
  );
  // The ladder is the whole story: no unscaled 22% or 30% anywhere on the card but the notes.
  await expect(card).not.toContainText("+22.00%");
  await expect(card).not.toContainText("+30.00%");
  // Soul Investiture ships at its full five stacks, so the top rung is the live one and the
  // panel carries its 12%.
  await expect(statValue(page, "outgoing_damage")).toHaveText("12.00%");
});

test("the bonus inspector breaks a scaled bonus down under its own heading", async ({
  page,
}) => {
  await openBuilder(page);
  await equipCollar(page);
  await ensureSectionExpanded(page, "gear");
  await chooseItem(page, "gear.head", "M29 Enchanted Depthweave Cap");
  await setShare(page, "scalers.encounterDamage", 40);

  await page.getByRole("button", { name: /^Bonuses/ }).click();
  const sidebar = page.getByTestId("details-sidebar");

  // The collar's grant is scaled: the summed payload gets the real value and share under it.
  const collar = sidebar.getByTestId("bonus-entry-sturdy-crescent-collar");
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
  const cap = sidebar.getByTestId(
    "bonus-entry-m29-enchanted-depthweave-cap-ca",
  );
  await cap.locator("button.group").click();
  await expect(cap.getByTestId("bonus-stat-row")).toHaveCount(1);
  await expect(cap).not.toContainText("Detailed scaling:");
  await expect(cap.getByTestId("bonus-grant-scale")).toHaveCount(0);
});
