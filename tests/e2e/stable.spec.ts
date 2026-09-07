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
  confirmImport,
  hoverForCard,
  importText,
  occurrenceCheckbox,
  undoButton,
} from "./support/app";
import { addBuild } from "./support/nav";

// Beholder Rune Board: crescent, regal, universal, universal preferring enlightened. Reaches
// Accursed Resolve with its preference satisfied.
const MOUNT = "Beholder Rune Board";
// Two preferences, and more bonuses than a hover card lists.
const CRIMSON = "Crimson Crystal Horse";
/** Fixed to regal then barbed, so it takes neither of the first two shapes MOUNT holds. */
const CACTUS = "Cactus the Hedgehog";
const CRESCENT = "Celestial Crescent Insignia of Brutality";
const REGAL = "Celestial Regal Insignia of Dominance";
const BARBED = "Celestial Barbed Insignia of Brutality";
const ENLIGHTENED = "Celestial Enlightened Insignia of Brutality";

/** The open build's own export, the starting point for a build the app could not have made. */
async function exportedBuild(page: Page) {
  const firstBuild = page.locator(".nav-row--build").first();
  await firstBuild.locator(".nav-kebab").click();
  const download = page.waitForEvent("download");
  await page
    .locator(".navmenu")
    .getByRole("button", { name: "Download…" })
    .click();
  const stream = await (await download).createReadStream();
  const chunks = await stream.toArray();
  return JSON.parse(Buffer.concat(chunks).toString("utf-8"));
}

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
  // Slot 4 prefers enlightened, so the upgraded half is the only one it offers, under the
  // ordinary name with a star.
  await chooseItem(page, "insignia.insignia1_4", ENLIGHTENED);
}

test("a mount's fixed slot only offers insignia of its own shape", async ({
  page,
}) => {
  await openStable(page);

  // With no mount the group is in its manual fallback and both halves of each pair are on
  // offer, differing by the star rather than by the name.
  const first = pickerInput(slotRow(page, "insignia.insignia1_1"));
  await first.click();
  await first.fill("Insignia of");
  await expect(
    slotRow(page, "insignia.insignia1_1")
      .getByText(BARBED, { exact: true })
      .first(),
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

  // Slot 3 is universal, so it still takes anything, listed under every bonus it leads to.
  const third = pickerInput(slotRow(page, "insignia.insignia1_3"));
  await third.click();
  await third.fill("Insignia of");
  await expect(
    slotRow(page, "insignia.insignia1_3")
      .getByText(BARBED, { exact: true })
      .first(),
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
  const offered = await fourthRow
    .getByText(ENLIGHTENED, { exact: true })
    .count();
  expect(offered).toBeGreaterThan(0);
  // Every row on offer is starred, which is what says the ordinary half is not among them.
  await expect(fourthRow.getByTestId("picker-option-preferred")).toHaveCount(
    offered,
  );
  await expect(
    fourthRow.getByText(`${ENLIGHTENED} (Pref)`, { exact: true }),
  ).toHaveCount(0);
  await page.keyboard.press("Escape");

  // Slot 3 is universal with no preference, so the ordinary half is the one offered.
  const third = pickerInput(slotRow(page, "insignia.insignia1_3"));
  await third.click();
  await third.fill(BARBED);
  const thirdRow = slotRow(page, "insignia.insignia1_3");
  await expect(
    thirdRow.getByText(BARBED, { exact: true }).first(),
  ).toBeVisible();
  await expect(thirdRow.getByTestId("picker-option-preferred")).toHaveCount(0);
});

test("clearing the mount hands the group back to manual and drops the preferred variant", async ({
  page,
}) => {
  await openStable(page);
  await chooseItem(page, "insignia.mount1", MOUNT);
  await chooseItem(page, "insignia.insignia1_4", ENLIGHTENED);
  await expect(pickerInput(slotRow(page, "insignia.insignia1_4"))).toHaveValue(
    ENLIGHTENED,
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

test("an insignia row is labelled with the shape its mount's slot takes", async ({
  page,
}) => {
  await openStable(page);
  const label = (slotId: string) =>
    slotRow(page, slotId).locator(".slot-label");

  // Without a mount nothing constrains the row, so the authored label stands.
  await expect(label("insignia.insignia1_1")).toHaveText("Insignia 1.1");
  await expect(
    pickerInput(slotRow(page, "insignia.insignia1_1")),
  ).toHaveAttribute("placeholder", "-");

  await chooseItem(page, "insignia.mount1", MOUNT);

  // Beholder Rune Board: crescent, regal, universal, universal preferring enlightened.
  await expect(label("insignia.insignia1_1")).toHaveText("crescent");
  await expect(label("insignia.insignia1_3")).toHaveText("universal");
  await expect(label("insignia.insignia1_4")).toHaveText(
    "universal (enlightened)",
  );

  // The label is where the rule lives, so filling the row does not take it away.
  await chooseItem(page, "insignia.insignia1_4", ENLIGHTENED);
  const fourth = slotRow(page, "insignia.insignia1_4");
  // The box carries the name, and the star sits out beside the summary where it has room.
  await expect(pickerInput(fourth)).toHaveValue(ENLIGHTENED);
  await expect(fourth.getByTestId("slot-preferred")).toHaveCount(1);
  await expect(
    slotRow(page, "insignia.insignia1_1").getByTestId("slot-preferred"),
  ).toHaveCount(0);
  await expect(label("insignia.insignia1_4")).toHaveText(
    "universal (enlightened)",
  );

  // Another group's mount is still unset, so that one keeps its authored label.
  await expect(label("insignia.insignia2_1")).toHaveText("Insignia 2.1");
});

test("a universal slot heads its insignia with the bonus each leads to", async ({
  page,
}) => {
  await openStable(page);
  await chooseItem(page, "insignia.mount1", MOUNT);
  await chooseItem(page, "insignia.insignia1_1", CRESCENT);
  await chooseItem(page, "insignia.insignia1_2", REGAL);

  // A fixed slot's candidates all share one shape, so every heading would list the same rows.
  const first = slotRow(page, "insignia.insignia1_1");
  await pickerInput(first).click();
  await expect(first.getByTestId("picker-group")).toHaveCount(0);
  await page.keyboard.press("Escape");

  // Crescent and regal are down, so Accursed Resolve is the nearest thing left.
  const third = slotRow(page, "insignia.insignia1_3");
  await pickerInput(third).click();
  await expect(third.getByTestId("picker-group").first()).toHaveText(
    "Accursed Resolve (4 insignia)",
  );
  // One insignia, several headings: a barbed one is a step toward more than one bonus.
  expect(
    await third.getByText(BARBED, { exact: true }).count(),
  ).toBeGreaterThan(1);
});

test("the bonus row says what its group is one insignia short of", async ({
  page,
}) => {
  await openStable(page);
  await chooseItem(page, "insignia.mount1", MOUNT);
  await chooseItem(page, "insignia.insignia1_1", CRESCENT);
  await chooseItem(page, "insignia.insignia1_2", REGAL);
  await chooseItem(page, "insignia.insignia1_4", ENLIGHTENED);

  // Three shapes down, one slot open: the row names what filling it would derive.
  await expect(pickerInput(slotRow(page, "insignia.bonus1"))).toHaveAttribute(
    "placeholder",
    /^1 short of Accursed Resolve \+\d+ more$/,
  );

  await chooseItem(page, "insignia.insignia1_3", BARBED);
  await expect(pickerInput(slotRow(page, "insignia.bonus1"))).toHaveAttribute(
    "placeholder",
    "Accursed Resolve",
  );
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

test("the bonus row derives itself and cannot be picked by hand", async ({
  page,
}) => {
  await openStable(page);
  await fillGroupOne(page);

  const row = slotRow(page, "insignia.bonus1");
  const bonus = pickerInput(row);
  await expect(bonus).toHaveAttribute("placeholder", "Accursed Resolve");
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

  // The group is what gets edited, so the row states its result and opens no list.
  await expect(bonus).toHaveJSProperty("readOnly", true);
  await bonus.click();
  await expect(row.getByTestId("picker-option-hidden-reason")).toHaveCount(0);
  await expect(row.getByTestId("unpin-bonus:insignia.bonus1")).toHaveCount(0);
});

test("a bonus pinned by an imported build stays until it is unpinned", async ({
  page,
}) => {
  await openStable(page);
  await fillGroupOne(page);

  // Stands in for a build made before the row became derived-only.
  const envelope = await exportedBuild(page);
  envelope.data.choices["insignia.bonus1"] = "gladiator-s-guile";
  await importText(page, JSON.stringify(envelope));
  await confirmImport(page);
  await ensureSectionExpanded(page, "insignia");

  const row = slotRow(page, "insignia.bonus1");
  await expect(pickerInput(row)).toHaveValue("Gladiator's Guile");

  await row.getByTestId("unpin-bonus:insignia.bonus1").click();
  await expect(pickerInput(row)).toHaveValue("");
  await expect(pickerInput(row)).toHaveAttribute(
    "placeholder",
    "Accursed Resolve",
  );
});

test("the browser sets the mount and leaves the insignia to the picker", async ({
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
  // The slots it opens up are the player's to fill.
  await expect(pickerInput(slotRow(page, "insignia.insignia1_1"))).toHaveValue(
    "",
  );

  await undoButton(page).click();
  await expect(pickerInput(slotRow(page, "insignia.mount1"))).toHaveValue("");
});

test("the by-mount side offers the pick once, on the mount it is about", async ({
  page,
}) => {
  await openStable(page);
  await page.getByTestId("open-stable-browser:insignia.mount1").click();
  await page.getByTestId("stable-filter").fill(MOUNT);

  // One mount heads the card, so one button, and none on the bonuses under it.
  const card = page.getByTestId("stable-group-card").first();
  await expect(card.getByTestId("stable-apply")).toHaveCount(1);
  await expect(
    card.getByTestId("stable-reach-row").first().getByTestId("stable-apply"),
  ).toHaveCount(0);

  await card.getByTestId("stable-apply").click();
  await expect(pickerInput(slotRow(page, "insignia.mount1"))).toHaveValue(
    MOUNT,
  );
});

test("the by-bonus side says what each bonus does before listing its mounts", async ({
  page,
}) => {
  await openStable(page);
  await page.getByTestId("open-stable-browser:insignia.mount1").click();

  // The by-mount side heads its cards with a mount, whose slots the header already states.
  await page.getByTestId("stable-filter").fill(MOUNT);
  await expect(page.getByTestId("stable-head-description")).toHaveCount(0);

  await page.getByTestId("stable-tab-bonus").click();
  await page.getByTestId("stable-filter").fill("Accursed Resolve");
  const card = page.getByTestId("stable-group-card").first();
  await expect(card.getByTestId("stable-head-description")).toContainText(
    "You gain 3500 Power and Deflect while inflicted with any debuff.",
  );

  // Ally's Resilience carries only a short description, which stands in for the long one.
  await page.getByTestId("stable-filter").fill("Ally's Resilience");
  await expect(
    page.getByTestId("stable-head-description").first(),
  ).toContainText("Whenever you receive damage");
});

test("an imported build whose insignia no longer fit is warned about, not corrected", async ({
  page,
}) => {
  await openStable(page);
  await fillGroupOne(page);

  // Slot 1 is fixed to crescent, so a barbed insignia there is only reachable from outside.
  const envelope = await exportedBuild(page);
  envelope.data.choices["insignia.insignia1_1"] = "brutality-barbed";
  await importText(page, JSON.stringify(envelope));
  await confirmImport(page);
  await ensureSectionExpanded(page, "insignia");

  const row = slotRow(page, "insignia.insignia1_1");
  await expect(row).toContainText("does not fit a crescent slot");
  // A warning, so the pick stays put and still carries its stats.
  await expect(pickerInput(row)).toHaveValue(BARBED);
  await expect(row.getByTestId("slot-stat-summary")).toContainText("IL");
});

test("the header opens the reference on its own, with nothing to set", async ({
  page,
}) => {
  await openBuilder(page);
  await page.getByTestId("header-tools").click();
  await page.getByRole("button", { name: "Mount stable reference" }).click();

  const browser = page.getByTestId("stable-browser");
  await expect(browser).toContainText("Stable reference");
  // No group behind it, so no mount to replace and nothing to warn about replacing.
  await expect(browser.getByTestId("stable-apply")).toHaveCount(0);
  await expect(page.getByTestId("stable-overwrite-warning")).toHaveCount(0);

  // Still the same tables: both directions are there to read.
  await expect(page.getByTestId("stable-group-card").first()).toBeVisible();
  await page.getByTestId("stable-tab-bonus").click();
  await page.getByTestId("stable-filter").fill("Accursed Resolve");
  await expect(page.getByTestId("stable-head-description")).toContainText(
    "You gain 3500 Power",
  );

  // A row's own button still opens it bound to that group.
  await page.getByTestId("modal-close").click();
  await ensureSectionExpanded(page, "insignia");
  await page.getByTestId("open-stable-browser:insignia.mount1").click();
  await expect(page.getByTestId("stable-browser")).toContainText("Mount 1");
  expect(await page.getByTestId("stable-apply").count()).toBeGreaterThan(0);
});

test("the filter has a clear button, which puts every row back", async ({
  page,
}) => {
  await openStable(page);
  await page.getByTestId("open-stable-browser:insignia.mount1").click();

  const clear = page.getByTestId("stable-filter-clear");
  await expect(clear).toHaveCount(0);

  await page.getByTestId("stable-filter").fill(MOUNT);
  await expect(page.getByTestId("stable-group-card")).toHaveCount(1);
  await clear.click();

  await expect(page.getByTestId("stable-filter")).toHaveValue("");
  expect(await page.getByTestId("stable-group-card").count()).toBeGreaterThan(
    1,
  );
});

test("swapping the mount drops the insignia its slots do not take", async ({
  page,
}) => {
  await openStable(page);
  await fillGroupOne(page);

  // Cactus the Hedgehog: regal, barbed, universal, universal preferring illuminated.
  await chooseItem(page, "insignia.mount1", CACTUS);

  // Slots 1 and 2 are fixed to shapes the old picks are not, so those go.
  await expect(pickerInput(slotRow(page, "insignia.insignia1_1"))).toHaveValue(
    "",
  );
  await expect(pickerInput(slotRow(page, "insignia.insignia1_2"))).toHaveValue(
    "",
  );
  // Slot 3 is universal on both mounts, so its pick stays put.
  await expect(pickerInput(slotRow(page, "insignia.insignia1_3"))).toHaveValue(
    BARBED,
  );
  // Slot 4 still takes it, but no longer prefers it, so the upgrade is handed back.
  await expect(pickerInput(slotRow(page, "insignia.insignia1_4"))).toHaveValue(
    ENLIGHTENED,
  );

  // One step: the swap and its evictions undo together.
  await undoButton(page).click();
  await expect(pickerInput(slotRow(page, "insignia.insignia1_1"))).toHaveValue(
    CRESCENT,
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

test("a derived bonus compares against a build deriving a different one", async ({
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

  // Deriving the same bonus on both sides is the same build, stored value or not.
  await fillGroupOne(page);
  await expect(row).not.toHaveClass(/is-diff/);
});
