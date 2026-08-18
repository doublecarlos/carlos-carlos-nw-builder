// End-to-end coverage for issue #286: mount and companion bolster scale the item's own stat
// line. Driven through the shipped data, since the two parameters and the three filters they
// claim are the whole feature -- there is nothing to author.
import { test, expect, type Page } from "@playwright/test";
import {
  openBuilder,
  ensureSectionExpanded,
  slotRow,
  pickerInput,
  chooseItem,
} from "./support/app";
import { statInfoButton, statCard, statCardClose } from "./support/stats";

/** A mount equip power carrying a full rating (2625 base) plus item level and combined
 *  rating -- enough for one stat to prove the scaling and another to prove it reached the
 *  pipeline, not just the row. */
const MOUNT_EQUIP = "Dominant Force";
/** Same section, claimed by no scaler: what proves the factor is per-item, not per-section. */
const COLLAR = "Sturdy Crescent Collar";

/** A stat's displayed value in the right-hand panel. */
function statValue(page: Page, key: string) {
  return page
    .locator(`[data-stat-row="${key}"]`)
    .getByTestId("stat-value")
    .first();
}

/** The same cell as a number, for asserting a *change* rather than a total. A rating row shows
 *  the stat plus every combined-rating contribution folded in (engine stage 3), so the absolute
 *  figure depends on everything else equipped -- the delta is what this feature owns. */
async function statNumber(page: Page, key: string): Promise<number> {
  const text = await statValue(page, key).textContent();
  return Number((text ?? "").replace(/[^0-9.-]/g, ""));
}

/** Types a percentage into a `paramType: percent` row (the input reads and writes percent
 *  units, not the decimal the build stores). */
async function setBolster(page: Page, slotId: string, percent: number) {
  const input = slotRow(page, slotId).locator("input");
  await input.click();
  await input.fill(String(percent));
  await input.blur();
}

test.describe("mount and companion bolster", () => {
  test("changing mount bolster rescales the mount's stats and leaves a collar alone", async ({
    page,
  }) => {
    await openBuilder(page);
    await ensureSectionExpanded(page, "mounts");

    await chooseItem(page, "mounts.mountEquip", MOUNT_EQUIP);
    await chooseItem(page, "mounts.sturdyCollar", COLLAR);

    // Dominant Force is 2625 Power + 1575 combined rating at base, and combined rating lands
    // on every rating too -- so dropping from max bolster (the default 125%) to 0 takes
    // (2625 + 1575) * 1.25 = 5250 off the Power row, whatever else is equipped alongside.
    const atMax = await statNumber(page, "power");
    await setBolster(page, "mounts.bolster", 0);
    await expect
      .poll(() => statNumber(page, "power"))
      .toBe(atMax - (2625 + 1575) * 1.25);

    // Linear in between: 60% is 1.6/2.25 of the max multiplier.
    await setBolster(page, "mounts.bolster", 60);
    await expect
      .poll(() => statNumber(page, "power"))
      .toBe(atMax - (2625 + 1575) * (2.25 - 1.6));
  });

  test("the collar's own contribution is unchanged across the same range", async ({
    page,
  }) => {
    await openBuilder(page);
    await ensureSectionExpanded(page, "mounts");
    await chooseItem(page, "mounts.sturdyCollar", COLLAR);

    const before = await statValue(page, "il").textContent();
    await setBolster(page, "mounts.bolster", 0);
    // Nothing scaled is equipped, so the total cannot move.
    await expect(statValue(page, "il")).toHaveText(before!);
  });

  test("the stat source popover reports the scaled figure, not the catalogue one", async ({
    page,
  }) => {
    await openBuilder(page);
    await ensureSectionExpanded(page, "mounts");
    await chooseItem(page, "mounts.mountEquip", MOUNT_EQUIP);

    await statInfoButton(page, "power").click();
    await expect(statCard(page)).toContainText("5,906");
    await statCardClose(page).click();

    await setBolster(page, "mounts.bolster", 0);
    await statInfoButton(page, "power").click();
    // The popover explains the panel's total, so it has to move with it.
    await expect(statCard(page)).toContainText("2,625");
    await expect(statCard(page)).not.toContainText("5,906");
  });

  test("mount and companion bolster are independent", async ({ page }) => {
    await openBuilder(page);
    await ensureSectionExpanded(page, "mounts");
    await ensureSectionExpanded(page, "companions");

    await chooseItem(page, "mounts.mountEquip", MOUNT_EQUIP);
    await chooseItem(page, "companions.companion", "Generic Companion");

    // Mount equip 1750 + companion 1800, each at its own max: 3937.5 + 3960 -> 7897.5.
    await expect(statValue(page, "il")).toHaveText("7,898");

    await setBolster(page, "companions.bolster", 0);
    // Only the companion drops to base: 3937.5 + 1800.
    await expect(statValue(page, "il")).toHaveText("5,738");
  });
});

// Every surface that shows an item's numbers has to show the same ones. An unscaled item level
// beside a scaled stat line reads as a contradiction, and in a picker it would rank candidates
// by a number none of them ends up having.
test.describe("bolster is reflected everywhere an item's numbers appear", () => {
  test("the in-row summary next to the picker", async ({ page }) => {
    await openBuilder(page);
    await ensureSectionExpanded(page, "mounts");
    await chooseItem(page, "mounts.mountEquip", MOUNT_EQUIP);

    const summary = slotRow(page, "mounts.mountEquip").getByTestId(
      "slot-stat-summary",
    );
    // 1750 * 2.25 = 3937.5, rounded once at the edge.
    await expect(summary).toContainText("3,938");

    await setBolster(page, "mounts.bolster", 0);
    await expect(summary).toContainText("1,750");
  });

  test("the hover card's item level badge, matching its own stat rows", async ({
    page,
  }) => {
    await openBuilder(page);
    await ensureSectionExpanded(page, "mounts");
    await chooseItem(page, "mounts.mountEquip", MOUNT_EQUIP);

    const label = slotRow(page, "mounts.mountEquip").locator(".slot-label");
    await label.hover();
    const card = page.locator(".itemcard");
    await expect(card).toBeVisible();
    // At max bolster the scaled item level is 3937.5, so this is also the check that the badge
    // rounds like every other displayed figure instead of leaking the raw fraction.
    await expect(card).toContainText("iL 3,938");
    await expect(card).not.toContainText("3,937.5");

    await page.mouse.move(0, 0);
    await setBolster(page, "mounts.bolster", 0);
    await label.hover();
    // Badge and body agree, and neither shows the max-bolster figure.
    await expect(card).toContainText("iL 1,750");
    await expect(card).not.toContainText("3,938");
  });

  test("the item level on each dropdown row", async ({ page }) => {
    await openBuilder(page);
    await ensureSectionExpanded(page, "mounts");
    await setBolster(page, "mounts.bolster", 0);

    const row = slotRow(page, "mounts.mountEquip");
    await pickerInput(row).click();
    // Candidates preview at the build's own bolster, so they are comparable to each other and
    // to what equipping one would actually do.
    await expect(row.getByText("iL 1,750").first()).toBeVisible();
    await expect(row.getByText("iL 3,938")).toHaveCount(0);
  });
});

test("a bolster outside its range is reported on the row, not clamped", async ({
  page,
}) => {
  await openBuilder(page);
  await ensureSectionExpanded(page, "companions");

  await setBolster(page, "companions.bolster", 1000);
  const row = slotRow(page, "companions.bolster");
  await expect(row).toContainText("is outside 0%–120%");
  // The value someone typed is still what the control shows -- reported, not rewritten.
  await expect(row.locator("input")).toHaveValue("1000");

  await setBolster(page, "companions.bolster", 120);
  await expect(row).not.toContainText("is outside");
});
