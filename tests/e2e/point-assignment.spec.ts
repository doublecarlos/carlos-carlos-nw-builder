// End-to-end coverage for a point_assignment slot's row of steppers (BuildSlot.vue via
// PointAssignmentInput.vue) -- the shipped "boons.tier1" example slot (data/slots.json)
// resolves several rows, including "Power" and "Critical Avoidance" (data/db-items.json's
// "boon_tier1" filter), each starting at their own default of 0.
import { test, expect } from "@playwright/test";
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
