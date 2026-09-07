// The stable in the editor: slot constraints, the preferred swap, the derived bonus row, and
// the browser.
import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";
import {
  openBuilder,
  ensureSectionExpanded,
  slotRow,
  pickerInput,
  chooseItem,
  chooseCombo,
  hoverForCard,
  occurrenceCheckbox,
  undoButton,
} from "./support/app";
import { addBuild } from "./support/nav";

// Beholder Rune Board: crescent, regal, universal, universal preferring enlightened. Reaches
// Accursed Resolve with its preference satisfied.
const MOUNT = "Beholder Rune Board";
// Two preferences, and more bonuses than a hover card lists.
const CRIMSON = "Crimson Crystal Horse";
const CRESCENT = "Celestial Crescent Insignia of Brutality";
const REGAL = "Celestial Regal Insignia of Dominance";
const BARBED = "Celestial Barbed Insignia of Brutality";
const ENLIGHTENED = "Celestial Enlightened Insignia of Brutality";
const ENLIGHTENED_PREF = `${ENLIGHTENED} (Pref)`;

async function openStable(page: Page) {
  await openBuilder(page);
  await ensureSectionExpanded(page, "insignia");
}

/** Fills group 1 with the shapes that make up Accursed Resolve. */
async function fillGroupOne(page: Page) {
  await chooseItem(page, "insignia.mount1", MOUNT);
  await chooseItem(page, "insignia.insignia1_1", CRESCENT);
  await chooseItem(page, "insignia.insignia1_2", REGAL);
  await chooseItem(page, "insignia.insignia1_3", BARBED);
  // Slot 4 prefers enlightened, so the upgraded half is the only one it offers.
  await chooseItem(page, "insignia.insignia1_4", ENLIGHTENED_PREF);
}

test("a mount's fixed slot only offers insignia of its own shape", async ({
  page,
}) => {
  await openStable(page);

  // With no mount the group is in its manual fallback and every shape is on offer.
  const first = pickerInput(slotRow(page, "insignia.insignia1_1"));
  await first.click();
  await first.fill("Insignia of");
  await expect(
    slotRow(page, "insignia.insignia1_1").getByText(BARBED, { exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Escape");

  await chooseItem(page, "insignia.mount1", MOUNT);

  // Slot 1 is fixed to crescent now, so a barbed insignia is no longer offered there.
  await first.click();
  await first.fill("Insignia of");
  await expect(
    slotRow(page, "insignia.insignia1_1").getByText(CRESCENT, { exact: true }),
  ).toBeVisible();
  await expect(
    slotRow(page, "insignia.insignia1_1").getByText(BARBED, { exact: true }),
  ).toHaveCount(0);
  await page.keyboard.press("Escape");

  // Slot 3 is universal, so it still takes anything.
  const third = pickerInput(slotRow(page, "insignia.insignia1_3"));
  await third.click();
  await third.fill("Insignia of");
  await expect(
    slotRow(page, "insignia.insignia1_3").getByText(BARBED, { exact: true }),
  ).toBeVisible();
});

test("a slot offers only the half of a pair that belongs in it", async ({
  page,
}) => {
  await openStable(page);
  await chooseItem(page, "insignia.mount1", MOUNT);

  // Slot 4 prefers enlightened, so only the upgraded half is on offer there.
  const fourth = pickerInput(slotRow(page, "insignia.insignia1_4"));
  await fourth.click();
  await fourth.fill(ENLIGHTENED);
  const fourthRow = slotRow(page, "insignia.insignia1_4");
  await expect(
    fourthRow.getByText(ENLIGHTENED_PREF, { exact: true }),
  ).toBeVisible();
  await expect(fourthRow.getByText(ENLIGHTENED, { exact: true })).toHaveCount(
    0,
  );
  await page.keyboard.press("Escape");

  // Slot 3 is universal with no preference, so the ordinary half is the one offered.
  const third = pickerInput(slotRow(page, "insignia.insignia1_3"));
  await third.click();
  await third.fill(BARBED);
  const thirdRow = slotRow(page, "insignia.insignia1_3");
  await expect(thirdRow.getByText(BARBED, { exact: true })).toBeVisible();
  await expect(
    thirdRow.getByText(`${BARBED} (Pref)`, { exact: true }),
  ).toHaveCount(0);
});

test("clearing the mount hands the group back to manual and drops the preferred variant", async ({
  page,
}) => {
  await openStable(page);
  await chooseItem(page, "insignia.mount1", MOUNT);
  await chooseItem(page, "insignia.insignia1_4", ENLIGHTENED_PREF);
  await expect(pickerInput(slotRow(page, "insignia.insignia1_4"))).toHaveValue(
    ENLIGHTENED_PREF,
  );

  const mount = pickerInput(slotRow(page, "insignia.mount1"));
  await mount.click();
  await mount.fill("");
  await slotRow(page, "insignia.mount1")
    .getByText("- empty -", { exact: true })
    .click();

  // No mount means no slot prefers anything, so the upgrade is given back.
  await expect(pickerInput(slotRow(page, "insignia.insignia1_4"))).toHaveValue(
    ENLIGHTENED,
  );
});

test("an empty insignia row says what its mount's slot takes", async ({
  page,
}) => {
  await openStable(page);

  // Without a mount nothing constrains the row, so it stays a bare dash.
  await expect(
    pickerInput(slotRow(page, "insignia.insignia1_1")),
  ).toHaveAttribute("placeholder", "-");

  await chooseItem(page, "insignia.mount1", MOUNT);

  // Beholder Rune Board: crescent, regal, universal, universal preferring enlightened.
  await expect(
    pickerInput(slotRow(page, "insignia.insignia1_1")),
  ).toHaveAttribute("placeholder", "crescent");
  await expect(
    pickerInput(slotRow(page, "insignia.insignia1_3")),
  ).toHaveAttribute("placeholder", "universal");
  await expect(
    pickerInput(slotRow(page, "insignia.insignia1_4")),
  ).toHaveAttribute("placeholder", "universal, prefers enlightened");
});

test("a filled insignia row still says what slot it is", async ({ page }) => {
  await openStable(page);
  await chooseItem(page, "insignia.mount1", MOUNT);

  // A filled row hides its placeholder, so the label note carries the rule.
  const fourth = slotRow(page, "insignia.insignia1_4");
  await expect(fourth.getByTestId("slot-label-note")).toHaveText(
    "universal, prefers enlightened",
  );
  await chooseItem(page, "insignia.insignia1_4", ENLIGHTENED_PREF);
  await expect(pickerInput(fourth)).toHaveValue(ENLIGHTENED_PREF);
  await expect(fourth.getByTestId("slot-label-note")).toHaveText(
    "universal, prefers enlightened",
  );

  // No mount, no rule to state.
  await expect(
    slotRow(page, "insignia.insignia2_1").getByTestId("slot-label-note"),
  ).toHaveCount(0);
});

test("a mount's hover card lists the bonuses it reaches, and a bonus lists its mounts", async ({
  page,
}) => {
  await openStable(page);
  await chooseItem(page, "insignia.mount1", MOUNT);

  await hoverForCard(
    page,
    slotRow(page, "insignia.mount1").locator(".slot-label"),
  );
  const card = page.getByTestId("item-card");
  await expect(card.getByTestId("item-card-stable")).toContainText(
    "Insignia bonuses",
  );
  await expect(card.getByTestId("item-card-stable")).toContainText("Slots:");
  await expect(card.getByTestId("item-card-stable-row").first()).toContainText(
    "★",
  );

  // The other direction, from the bonus this group derives.
  await fillGroupOne(page);
  await chooseItem(page, "insignia.bonus1", "Accursed Resolve");
  await hoverForCard(
    page,
    slotRow(page, "insignia.bonus1").locator(".slot-label"),
  );
  await expect(page.getByTestId("item-card-stable")).toContainText("Mounts");
  await expect(page.getByTestId("item-card-stable")).toContainText(MOUNT);
});

test("the hover card's 'more' opens the browser on what the card was showing", async ({
  page,
}) => {
  await openStable(page);
  await chooseItem(page, "insignia.mount1", CRIMSON);

  await hoverForCard(
    page,
    slotRow(page, "insignia.mount1").locator(".slot-label"),
  );
  // Its best pairings meet both of its preferences, so they carry two stars.
  await expect(page.getByTestId("item-card-stable-row").first()).toContainText(
    "★★",
  );
  await page.getByTestId("item-card-stable-more").click();

  // Opened onto the mount the card was about, on the by-mount side, for that mount's group.
  await expect(page.getByTestId("stable-browser")).toBeVisible();
  await expect(page.getByTestId("stable-browser")).toContainText("Mount 1");
  await expect(page.getByTestId("stable-filter")).toHaveValue(CRIMSON);
  await expect(page.getByTestId("stable-group-card").first()).toContainText(
    CRIMSON,
  );
});

test("the bonus row derives itself and an explicit pick overrides it", async ({
  page,
}) => {
  await openStable(page);
  await fillGroupOne(page);

  const row = slotRow(page, "insignia.bonus1");
  const bonus = pickerInput(row);
  await expect(bonus).toHaveAttribute("placeholder", "auto: Accursed Resolve");
  await expect(bonus).toHaveValue("");

  // The picker is empty but the row is still about that bonus.
  await hoverForCard(page, row.locator(".slot-label"));
  await expect(page.getByTestId("item-card-name")).toHaveText(
    "Accursed Resolve",
  );
  await page.mouse.move(0, 0);

  // Accursed Resolve only pays out while debuffed, so its Proc input reaches the derived bonus
  // the same way it would a picked one.
  await expect(row.getByTestId("slot-stat-summary")).toBeEmpty();
  await occurrenceCheckbox(row, "accursed-resolve").check();
  await expect(row.getByTestId("slot-stat-summary")).toContainText("Power");

  await chooseItem(page, "insignia.bonus1", "Gladiator's Guile");
  await expect(bonus).toHaveValue("Gladiator's Guile");
});

test("the browser applies a mount and its insignia as one undoable step", async ({
  page,
}) => {
  await openStable(page);
  await page.getByTestId("open-stable-browser:insignia.mount1").click();
  await expect(page.getByTestId("stable-browser")).toBeVisible();

  await page.getByTestId("stable-tab-bonus").click();
  await page.getByTestId("stable-filter").fill("Accursed Resolve");

  const card = page.getByTestId("stable-group-card").first();
  await expect(card).toContainText("Accursed Resolve");
  // Rows that also satisfy a preferred slot are starred and sort first.
  const firstRow = card.getByTestId("stable-reach-row").first();
  await expect(firstRow).toContainText("★");
  await firstRow.getByTestId("stable-apply").click();

  await expect(page.getByTestId("stable-browser")).toHaveCount(0);
  await expect(pickerInput(slotRow(page, "insignia.mount1"))).not.toHaveValue(
    "",
  );
  await expect(pickerInput(slotRow(page, "insignia.bonus1"))).toHaveAttribute(
    "placeholder",
    "auto: Accursed Resolve",
  );

  // One step, not five: a single undo puts the whole group back.
  await undoButton(page).click();
  await expect(pickerInput(slotRow(page, "insignia.mount1"))).toHaveValue("");
  await expect(pickerInput(slotRow(page, "insignia.insignia1_1"))).toHaveValue(
    "",
  );
});

test("the browser applies to the mount row it was opened from", async ({
  page,
}) => {
  await openStable(page);
  await fillGroupOne(page);

  // Opened from group 2, which holds nothing, so there is nothing to warn about.
  await page.getByTestId("open-stable-browser:insignia.mount2").click();
  await expect(page.getByTestId("stable-browser")).toContainText("Mount 2");
  await expect(page.getByTestId("stable-overwrite-warning")).toHaveCount(0);
  await page.keyboard.press("Escape");

  // Opened from group 1, which is full, so it names what applying would replace.
  await page.getByTestId("open-stable-browser:insignia.mount1").click();
  await expect(page.getByTestId("stable-overwrite-warning")).toContainText(
    MOUNT,
  );
  await page.keyboard.press("Escape");

  // A row applied from group 2's button lands in group 2, leaving group 1 alone.
  await page.getByTestId("open-stable-browser:insignia.mount2").click();
  await page.getByTestId("stable-tab-bonus").click();
  await page.getByTestId("stable-filter").fill("Accursed Resolve");
  await page
    .getByTestId("stable-group-card")
    .first()
    .getByTestId("stable-reach-row")
    .first()
    .getByTestId("stable-apply")
    .click();

  await expect(pickerInput(slotRow(page, "insignia.mount1"))).toHaveValue(
    MOUNT,
  );
  await expect(pickerInput(slotRow(page, "insignia.mount2"))).not.toHaveValue(
    "",
  );
});

test("a derived bonus compares against a build that pins one, and against one deriving none", async ({
  page,
}) => {
  await openBuilder(page);
  await ensureSectionExpanded(page, "insignia");
  // Build 1 derives Accursed Resolve from its own insignia, storing nothing on the bonus row.
  await fillGroupOne(page);

  await addBuild(page);
  await ensureSectionExpanded(page, "insignia");
  await chooseCombo(page.locator(".compare-select"), "Build 1");
  await page.getByRole("checkbox", { name: "Highlight changes" }).check();

  // Build 2's bonus row is empty too and derives nothing, having no mount. Comparing stored
  // values alone would call the two rows identical.
  const row = slotRow(page, "insignia.bonus1");
  await expect(row).toHaveClass(/is-diff/);
  await expect(row.locator(".slot-diff-note")).toContainText(
    "Accursed Resolve",
  );

  // Auto on one side and a manual pick on the other are the same build.
  await chooseItem(page, "insignia.bonus1", "Accursed Resolve");
  await expect(row).not.toHaveClass(/is-diff/);
});
