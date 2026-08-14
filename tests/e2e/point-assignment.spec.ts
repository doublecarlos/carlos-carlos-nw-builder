// End-to-end coverage for a point_assignment slot's row of steppers (BuildSlot.vue via
// PointAssignmentInput.vue) -- the shipped "boons.tier1" example slot (data/slots.json)
// resolves several rows, including "Power" and "Critical Avoidance" (data/db-items.json's
// "boon_tier1" filter), each starting at their own default of 0.
import { test, expect, type Page } from "@playwright/test";
import {
  openBuilder,
  slotRow,
  assignmentInput,
  assignmentLabel,
  stepAssignment,
} from "./support/app";

const SLOT_ID = "boons.tier1";
const POWER_ID = "boon-tier1-power";
const AVOIDANCE_ID = "boon-tier1-avoidance";

test.describe("point_assignment steppers", () => {
  test("both rows start at their default of 0", async ({ page }) => {
    await openBuilder(page);
    const row = slotRow(page, SLOT_ID);
    await expect(row).toBeVisible();
    await expect(assignmentInput(row, POWER_ID)).toHaveValue("0");
    await expect(assignmentInput(row, AVOIDANCE_ID)).toHaveValue("0");
  });

  test("the + button increments one item's count without touching the other's", async ({
    page,
  }) => {
    await openBuilder(page);
    const row = slotRow(page, SLOT_ID);

    await stepAssignment(row, POWER_ID, "increase");
    await stepAssignment(row, POWER_ID, "increase");

    await expect(assignmentInput(row, POWER_ID)).toHaveValue("2");
    await expect(assignmentInput(row, AVOIDANCE_ID)).toHaveValue("0");
  });

  test("the - button decrements, and stops at the row's min", async ({
    page,
  }) => {
    await openBuilder(page);
    const row = slotRow(page, SLOT_ID);

    await stepAssignment(row, POWER_ID, "increase");
    await stepAssignment(row, POWER_ID, "decrease");
    await expect(assignmentInput(row, POWER_ID)).toHaveValue("0");

    // Already at min (0) -- the - button is disabled, one more click is a no-op.
    await expect(row.getByTestId(`assignment-input-${POWER_ID}`)).toHaveValue(
      "0",
    );
  });

  test("typing a value directly updates the count", async ({ page }) => {
    await openBuilder(page);
    const row = slotRow(page, SLOT_ID);
    const input = assignmentInput(row, AVOIDANCE_ID);

    await input.fill("3");
    await input.blur();

    await expect(input).toHaveValue("3");
  });

  test("Backspace on the row resets every item in the slot to its default", async ({
    page,
  }) => {
    await openBuilder(page);
    const row = slotRow(page, SLOT_ID);

    await stepAssignment(row, POWER_ID, "increase");
    await stepAssignment(row, AVOIDANCE_ID, "increase");
    await expect(assignmentInput(row, POWER_ID)).toHaveValue("1");
    await expect(assignmentInput(row, AVOIDANCE_ID)).toHaveValue("1");

    // Park the cursor on the row (not its inputs) and reset via the keyboard cursor.
    await row.locator(".slot-label").click();
    await page.keyboard.press("Backspace");

    await expect(assignmentInput(row, POWER_ID)).toHaveValue("0");
    await expect(assignmentInput(row, AVOIDANCE_ID)).toHaveValue("0");
  });
});

// Ctrl/Cmd+click on a stepper jumps straight to that direction's bound instead of stepping by
// one -- distinct from the row-level Ctrl+click-to-edit below, which targets an item's label
// rather than its +/- buttons and is a no-op for point_assignment rows outside a label.
test.describe("point_assignment Ctrl+click steppers", () => {
  test("Ctrl+click on + jumps straight to the row's max", async ({ page }) => {
    await openBuilder(page);
    const row = slotRow(page, SLOT_ID);

    await stepAssignment(row, POWER_ID, "increase", {
      modifiers: ["Control"],
    });

    await expect(assignmentInput(row, POWER_ID)).toHaveValue("5");
    await expect(assignmentInput(row, AVOIDANCE_ID)).toHaveValue("0");
  });

  test("the +/- tooltips mention the Ctrl+click shortcut", async ({ page }) => {
    await openBuilder(page);
    const row = slotRow(page, SLOT_ID);
    const wrapper = assignmentInput(row, POWER_ID).locator("..");

    await expect(
      wrapper.getByTitle("Increase", { exact: false }),
    ).toHaveAttribute("title", /Ctrl\+click for max/);
    await expect(
      wrapper.getByTitle("Decrease", { exact: false }),
    ).toHaveAttribute("title", /Ctrl\+click for min/);
  });

  test("Ctrl+click on - jumps straight to the row's min", async ({ page }) => {
    await openBuilder(page);
    const row = slotRow(page, SLOT_ID);

    await stepAssignment(row, POWER_ID, "increase", {
      modifiers: ["Control"],
    });
    await expect(assignmentInput(row, POWER_ID)).toHaveValue("5");

    await stepAssignment(row, POWER_ID, "decrease", {
      modifiers: ["Control"],
    });

    await expect(assignmentInput(row, POWER_ID)).toHaveValue("0");
  });
});

// The hover card is the same machinery an item_picker row's whole-row hover already uses
// (useHoverCard.ts / ItemCard.vue via BuildEditor.vue's single shared BasePopover) -- here
// the trigger is one row's item-name label instead of the whole row, since a point_assignment
// row has several items, not one.
//
// Each test scrolls the row into view before hovering: the Boons section sits well below the
// fold, so `locator.hover()` would otherwise auto-scroll to it as part of the hover action --
// and useHoverCard.ts's own onScroll listener (correctly, for a *real* user scrolling away)
// cancels any pending hover-open timer on every scroll, including that auto-scroll, racing
// the card closed before it ever opens.
test.describe("point_assignment hover card", () => {
  test("hovering an item's label shows its card, with the row's own label", async ({
    page,
  }) => {
    await openBuilder(page);
    const row = slotRow(page, SLOT_ID);
    await row.scrollIntoViewIfNeeded();

    await assignmentLabel(row, POWER_ID).hover();

    const card = page.locator(".fixed.z-40");
    await expect(card.getByTestId("item-card-name")).toHaveText("Power");
    await expect(card.getByText("Tier 1")).toBeVisible();
  });

  test("the card previews an item whether or not points are currently spent on it", async ({
    page,
  }) => {
    await openBuilder(page);
    const row = slotRow(page, SLOT_ID);
    await row.scrollIntoViewIfNeeded();
    await expect(assignmentInput(row, POWER_ID)).toHaveValue("0");

    await assignmentLabel(row, POWER_ID).hover();

    await expect(
      page.locator(".fixed.z-40").getByTestId("item-card-name"),
    ).toHaveText("Power");
  });

  test("hovering a different item's label in the same row swaps the card", async ({
    page,
  }) => {
    await openBuilder(page);
    const row = slotRow(page, SLOT_ID);
    await row.scrollIntoViewIfNeeded();
    const card = page.locator(".fixed.z-40");

    await assignmentLabel(row, POWER_ID).hover();
    await expect(card.getByTestId("item-card-name")).toHaveText("Power");

    await assignmentLabel(row, AVOIDANCE_ID).hover();
    await expect(card.getByTestId("item-card-name")).toHaveText(
      "Critical Avoidance",
    );
  });

  test("moving the pointer away closes the card", async ({ page }) => {
    await openBuilder(page);
    const row = slotRow(page, SLOT_ID);
    await row.scrollIntoViewIfNeeded();
    const card = page.locator(".fixed.z-40");

    await assignmentLabel(row, POWER_ID).hover();
    await expect(card).toBeVisible();

    await page.mouse.move(0, 0);
    await expect(card).toBeHidden();
  });
});

// bonus.ts's collectInlineRepetition walks every point_assignment candidate for reachability
// regardless of its own count, same as an item_picker item's zero-valued BonusOccurrenceConfig
// already does -- so hovering an unselected candidate (0 points spent) still shows its bonuses,
// inactive with their own zero-occurrence notes, instead of nothing at all.
test.describe("point_assignment hover card for an unselected candidate", () => {
  const DIAL_ITEM_ID = "test-tier1-dial-item";
  const DIAL_BONUS_ID = "test-tier1-dial-bonus";
  // Mirrors the shipped "Deathly Rage" shape: a bare-id bonus gated on a sibling
  // BonusOccurrenceConfig attachment on the same item.
  const PROC_BONUS_ID = "test-tier1-proc-bonus";
  const STATS_BONUS_ID = "test-tier1-stats-bonus";

  async function importBoons(page: Page) {
    const fileInput = page
      .getByTestId("app-header")
      .locator('input[type="file"]');
    await fileInput.setInputFiles({
      name: "import.json",
      mimeType: "application/json",
      buffer: Buffer.from(
        JSON.stringify({
          name: "Point assignment hover test",
          catalog: {
            items: {
              [DIAL_ITEM_ID]: {
                id: DIAL_ITEM_ID,
                name: "Test Dial Boon",
                filter: "boon_tier1",
                inlineRepetition: { min: 0, max: 3, default: 0 },
                bonuses: [
                  {
                    bonus: DIAL_BONUS_ID,
                    min: 0,
                    max: 1,
                    default: 0,
                    label: "Proc",
                  },
                ],
              },
              "test-tier1-master-item": {
                id: "test-tier1-master-item",
                name: "Test Master Boon",
                filter: "boon_tier1",
                inlineRepetition: { min: 0, max: 3, default: 0 },
                bonuses: [
                  STATS_BONUS_ID,
                  {
                    bonus: PROC_BONUS_ID,
                    min: 0,
                    max: 1,
                    default: 0,
                    label: "proc",
                  },
                ],
              },
            },
            bonuses: {
              [DIAL_BONUS_ID]: {
                id: DIAL_BONUS_ID,
                name: "Test Dial Bonus",
                grants: [{ stats: { power: 5 } }],
              },
              [PROC_BONUS_ID]: {
                id: PROC_BONUS_ID,
                name: "Test Proc",
                grants: [],
              },
              [STATS_BONUS_ID]: {
                id: STATS_BONUS_ID,
                name: "Test Master Stats",
                grants: [
                  {
                    when: {
                      bonusOccurrences: { bonus: PROC_BONUS_ID, exactly: 1 },
                    },
                    stats: { power: 100 },
                  },
                ],
              },
            },
            sectionPresets: {},
          },
        }),
        "utf-8",
      ),
    });
    await expect(page.getByTestId("app-header")).toContainText(/imported/i);
  }

  test("at 0 points, still shows the candidate's own bonus, explained by its own zero-valued config", async ({
    page,
  }) => {
    await openBuilder(page);
    await importBoons(page);

    const row = slotRow(page, SLOT_ID);
    await row.scrollIntoViewIfNeeded();
    await expect(assignmentInput(row, DIAL_ITEM_ID)).toHaveValue("0");

    await assignmentLabel(row, DIAL_ITEM_ID).hover();
    const card = page.locator(".fixed.z-40");
    await expect(card.getByTestId("item-card-name")).toHaveText(
      "Test Dial Boon",
    );
    await expect(card).toContainText("Test Dial Bonus");
    await expect(
      card.getByTestId("item-card-bonus-zero-occurrence"),
    ).toContainText("Proc: off on this item");
  });

  test("once points are actually spent, its own config still independently gates the bonus", async ({
    page,
  }) => {
    await openBuilder(page);
    await importBoons(page);

    const row = slotRow(page, SLOT_ID);
    await row.scrollIntoViewIfNeeded();
    await stepAssignment(row, DIAL_ITEM_ID, "increase");
    await expect(assignmentInput(row, DIAL_ITEM_ID)).toHaveValue("1");

    await assignmentLabel(row, DIAL_ITEM_ID).hover();
    const card = page.locator(".fixed.z-40");
    await expect(card).toContainText("Test Dial Bonus");
    // The bonus attachment is still its own independent 0-valued config -- spending points on
    // the item itself doesn't turn it on.
    await expect(
      card.getByTestId("item-card-bonus-zero-occurrence"),
    ).toContainText("Proc: off on this item");
  });

  test("a checked proc left over from before doesn't falsely activate its bonus while the item is at 0 points", async ({
    page,
  }) => {
    await openBuilder(page);
    await importBoons(page);

    const row = slotRow(page, SLOT_ID);
    await row.scrollIntoViewIfNeeded();
    // A point_assignment item's own occurrence checkbox/stepper testids are keyed by item id
    // *and* bonus id (PointAssignmentInput.vue) -- an item_picker row's own `occurrenceCheckbox`
    // helper only keys by bonus id, since a picker row has just the one item.
    await row
      .getByTestId(
        `assignment-occurrence-toggle-test-tier1-master-item-${PROC_BONUS_ID}`,
      )
      .locator("input")
      .check();
    // The checkbox keeps real focus after `.check()`, which useHoverCard.ts's own
    // onFocusIn/onFocusOut treats as "editing" and suppresses the next hover for -- blur it
    // explicitly rather than just moving the pointer away.
    await page.keyboard.press("Escape");
    await row.locator(".slot-label").click();

    await assignmentLabel(row, "test-tier1-master-item").hover();
    const card = page.locator(".fixed.z-40");
    await expect(card).toContainText("Test Master Stats");
    // Reads inactive, with the real "you have 0" reason -- not as if the checked proc made it
    // active, and not multiplied down to a wrong "0" preview either.
    await expect(card).toContainText("needs 1 occurrence(s) of Test Proc");
    await expect(card).toContainText("you have 0");
    await expect(card.locator(".bg-ok")).toHaveCount(0);
  });
});

// Mirrors slot-list.spec.ts's "row click behaviour" coverage for item_picker rows: Ctrl/Cmd
// click jumps straight to a layer's item form. A point_assignment row has several items, not
// one, so the target here is one item's own label (assignmentLabel) rather than the row's
// `.slot-label` -- ctrl-clicking the row's own label stays a no-op, same as an empty slot.
test.describe("point_assignment Ctrl+click", () => {
  test("Ctrl+click on an item's label opens the layer editor on that item", async ({
    page,
  }) => {
    await openBuilder(page);
    const row = slotRow(page, SLOT_ID);
    await row.scrollIntoViewIfNeeded();

    await assignmentLabel(row, POWER_ID).click({ modifiers: ["Control"] });

    await expect(page.getByTestId("builder-content")).toBeHidden();
    await expect(page.locator(".editor-row.is-on .editor-row-name")).toHaveText(
      "Power",
    );
  });

  test("Ctrl+click on a different item's label in the same row opens that item instead", async ({
    page,
  }) => {
    await openBuilder(page);
    const row = slotRow(page, SLOT_ID);
    await row.scrollIntoViewIfNeeded();

    await assignmentLabel(row, AVOIDANCE_ID).click({
      modifiers: ["Control"],
    });

    await expect(page.locator(".editor-row.is-on .editor-row-name")).toHaveText(
      "Critical Avoidance",
    );
  });

  test("Ctrl+click on the row's own label (not an item) does nothing", async ({
    page,
  }) => {
    await openBuilder(page);
    const row = slotRow(page, SLOT_ID);
    await row.scrollIntoViewIfNeeded();

    await row.locator(".slot-label").click({ modifiers: ["Control"] });

    await expect(page.getByTestId("builder-content")).toBeVisible();
  });
});
