// End-to-end coverage for a `toggleable` slot's checkbox: unchecking it takes the pick out of
// the calculation while leaving it in the picker and in the saved build. Driven through a
// build's own catalog overlay (`Build.catalog`) rather than a shipped consumable, so the stat
// the panel is asserted against belongs to this spec.
import { test, expect, type Page } from "@playwright/test";
import {
  openBuilder,
  ensureSectionExpanded,
  importText,
  confirmImport,
  slotRow,
  pickerInput,
  parkCursorOnRow,
  chooseItem,
  chooseCombo,
} from "./support/app";

/** A shipped `toggleable` slot, and an ordinary one to line its picker up against. */
const ELIXIR_SLOT = "buffs.elixir";
const RING_SLOT = "gear.ring1";
const FOOD_SLOT = "buffs.food";
const ELIXIR_ID = "test-toggleable-elixir";
const ELIXIR_NAME = "Test Toggle Elixir";
const BONUS_ID = "test-toggleable-bonus";
const POWER = 4321;
const BONUS_POWER = 1234;

function toggle(page: Page, slotId: string) {
  return page.getByTestId(`slot-toggle:${slotId}`);
}

function statValue(page: Page, key: string) {
  return page
    .locator(`[data-stat-row="${key}"]`)
    .getByTestId("stat-value")
    .first();
}

async function statNumber(page: Page, key: string): Promise<number> {
  const text = await statValue(page, key).textContent();
  return Number((text ?? "").replace(/[^0-9.-]/g, ""));
}

/** One custom elixir, equipped in the shipped Elixir slot. Carries stats of its own and a
 *  bonus, so the row summary can be read for both. */
const buildWithElixir = JSON.stringify({
  name: "Toggle test",
  choices: { [ELIXIR_SLOT]: ELIXIR_ID },
  catalog: {
    items: {
      [ELIXIR_ID]: {
        id: ELIXIR_ID,
        name: ELIXIR_NAME,
        filter: "consumable_elixir",
        power: POWER,
        bonuses: [BONUS_ID],
      },
    },
    bonuses: {
      [BONUS_ID]: {
        id: BONUS_ID,
        name: "Test Toggle Bonus",
        grants: [
          {
            stats: { awareness: BONUS_POWER },
            shortDescription: "toggle bonus line",
          },
        ],
      },
    },
    sectionPresets: {},
  },
});

async function openWithElixir(page: Page) {
  await openBuilder(page);
  await importText(page, buildWithElixir);
  await confirmImport(page);
  await expect(page.getByTestId("app-header")).toContainText(/imported/i);
  await ensureSectionExpanded(page, "buffs");
  await expect(pickerInput(slotRow(page, ELIXIR_SLOT))).toHaveValue(
    new RegExp(ELIXIR_NAME),
  );
}

test.describe("toggleable slot", () => {
  test("shows a checked box on a filled toggleable row, nothing on an ordinary one", async ({
    page,
  }) => {
    await openWithElixir(page);

    await expect(toggle(page, ELIXIR_SLOT)).toBeChecked();
    await expect(toggle(page, RING_SLOT)).toHaveCount(0);
  });

  test("hides the box while the row is empty, without moving the picker", async ({
    page,
  }) => {
    await openWithElixir(page);

    // Same section, same slot type, no pick: the box is out of sight but its space is kept,
    // so both pickers start at the same x.
    await expect(toggle(page, FOOD_SLOT)).toBeHidden();
    const filled = await pickerInput(slotRow(page, ELIXIR_SLOT)).boundingBox();
    const empty = await pickerInput(slotRow(page, FOOD_SLOT)).boundingBox();
    expect(empty!.x).toBe(filled!.x);
  });

  test("keeps every picker aligned with an ordinary row's", async ({
    page,
  }) => {
    await openWithElixir(page);
    await ensureSectionExpanded(page, "gear");

    const toggleable = await pickerInput(
      slotRow(page, ELIXIR_SLOT),
    ).boundingBox();
    const ordinary = await pickerInput(slotRow(page, RING_SLOT)).boundingBox();
    expect(toggleable!.x).toBe(ordinary!.x);
  });

  // A row grown by a compare note used to re-center the label column over the taller row,
  // floating the checkbox away from the control it belongs to.
  test("keeps the box on the picker's line when a compare note grows the row", async ({
    page,
  }) => {
    await openWithElixir(page);
    const box = toggle(page, ELIXIR_SLOT);
    const lineUp = async () => {
      const check = (await box.boundingBox())!;
      const picker = (await pickerInput(slotRow(page, ELIXIR_SLOT))
        .first()
        .boundingBox())!;
      return Math.abs(
        check.y + check.height / 2 - (picker.y + picker.height / 2),
      );
    };
    expect(await lineUp()).toBeLessThan(3);

    // The starting build holds no elixir, so comparing against it puts a note under this
    // row's picker and makes the row taller than one line.
    await chooseCombo(page.locator(".compare-select"), "Build 1");
    await page.getByRole("checkbox", { name: "Highlight changes" }).check();
    const row = slotRow(page, ELIXIR_SLOT);
    await expect(row.locator(".slot-diff-note")).toBeVisible();

    expect(await lineUp()).toBeLessThan(3);
  });

  test("unchecking drops the pick from the totals but leaves it in the picker", async ({
    page,
  }) => {
    await openWithElixir(page);
    const withElixir = await statNumber(page, "power");

    await toggle(page, ELIXIR_SLOT).uncheck();

    await expect(statValue(page, "power")).not.toHaveText(
      String(withElixir).replace(/\B(?=(\d{3})+(?!\d))/g, ","),
    );
    expect(await statNumber(page, "power")).toBe(withElixir - POWER);
    await expect(pickerInput(slotRow(page, ELIXIR_SLOT))).toHaveValue(
      new RegExp(ELIXIR_NAME),
    );

    await toggle(page, ELIXIR_SLOT).check();
    expect(await statNumber(page, "power")).toBe(withElixir);
  });

  test("drops the row summary while switched off, and brings it back", async ({
    page,
  }) => {
    await openWithElixir(page);
    const summary = slotRow(page, ELIXIR_SLOT).getByTestId("slot-stat-summary");
    const on = await summary.textContent();
    expect(on).toContain("toggle bonus line");
    expect(on).toContain("1,234");

    // Nothing at all, the same as any row whose bonus is inactive: a switched-off row
    // contributes nothing, and the struck-through pick already says which item is parked.
    await toggle(page, ELIXIR_SLOT).uncheck();
    await expect(summary).toHaveText("");

    await toggle(page, ELIXIR_SLOT).check();
    await expect(summary).toHaveText(on!);
  });

  test("drops the summary of a bonus gated on its own occurrence count too", async ({
    page,
  }) => {
    // Every tier is gated on the occurrence count, which the switch takes to 0, so this row
    // has nothing left to report through any channel.
    const build = JSON.stringify({
      name: "Tiered toggle test",
      choices: { [ELIXIR_SLOT]: ELIXIR_ID },
      catalog: {
        items: {
          [ELIXIR_ID]: {
            id: ELIXIR_ID,
            name: ELIXIR_NAME,
            filter: "consumable_elixir",
            bonuses: [{ bonus: BONUS_ID, min: 0, max: 4, default: 2 }],
          },
        },
        bonuses: {
          [BONUS_ID]: {
            id: BONUS_ID,
            name: "Test Tiered Bonus",
            grants: [
              {
                tiers: [
                  {
                    bonusOccurrences: { bonus: BONUS_ID, atLeast: 1 },
                    stats: { awareness: 100 },
                  },
                  {
                    bonusOccurrences: { bonus: BONUS_ID, atLeast: 2 },
                    stats: { awareness: BONUS_POWER },
                  },
                ],
              },
            ],
          },
        },
        sectionPresets: {},
      },
    });

    await openBuilder(page);
    await importText(page, build);
    await confirmImport(page);
    await expect(page.getByTestId("app-header")).toContainText(/imported/i);
    await ensureSectionExpanded(page, "buffs");

    const summary = slotRow(page, ELIXIR_SLOT).getByTestId("slot-stat-summary");
    const on = await summary.textContent();
    expect(on).toContain("1,234");

    await toggle(page, ELIXIR_SLOT).uncheck();
    await expect(summary).toHaveText("");
  });

  test("strikes the switched-off pick through", async ({ page }) => {
    await openWithElixir(page);
    const input = pickerInput(slotRow(page, ELIXIR_SLOT));

    await expect(input).toHaveCSS("text-decoration-line", "none");
    await toggle(page, ELIXIR_SLOT).uncheck();
    await expect(input).toHaveCSS("text-decoration-line", "line-through");
  });

  test("clearing the row switches it back on", async ({ page }) => {
    await openWithElixir(page);
    await toggle(page, ELIXIR_SLOT).uncheck();

    await parkCursorOnRow(page, ELIXIR_SLOT);
    await page.keyboard.press("Backspace");
    await expect(pickerInput(slotRow(page, ELIXIR_SLOT))).toHaveValue("");
    await expect(toggle(page, ELIXIR_SLOT)).toBeHidden();

    // The state is gone with the pick, not merely hidden: the same item picked again comes
    // back counted.
    await chooseItem(page, ELIXIR_SLOT, ELIXIR_NAME);
    await expect(toggle(page, ELIXIR_SLOT)).toBeChecked();
  });
});
