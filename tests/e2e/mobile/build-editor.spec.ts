// The build editor on a phone: a row stacks its label over its control, the toolbar's actions
// live in an overflow menu, and the item card opens from a button instead of on hover. Fit at
// phone widths is checked in layout-sweep.spec.ts.
import { test, expect, type Locator, type Page } from "@playwright/test";
import {
  blurToHeader,
  chooseItem,
  ensureSectionExpanded,
  openBuilder,
  pickerInput,
  slotRow,
} from "../support/app";
import { importTestCatalog } from "../support/testCatalog";
import { TEST_HEAD, importTestHead } from "../support/testHead";

const HEAD_ITEM = TEST_HEAD.name;

const actionsMenu = (page: Page) => page.getByTestId("editor-actions");
const action = (page: Page, key: string) =>
  page.getByTestId(`editor-actions-${key}`);
const sheet = (page: Page) => page.getByTestId("item-card-sheet");

test("a row's label sits above its control", async ({ page }) => {
  await openBuilder(page);
  const row = slotRow(page, "gear.head");
  const label = (await row.locator(".slot-label").boundingBox())!;
  const input = (await pickerInput(row).boundingBox())!;
  expect(input.y).toBeGreaterThanOrEqual(label.y + label.height);
});

test("the toolbar's actions sit in an overflow menu", async ({ page }) => {
  await openBuilder(page);
  await expect(page.getByTestId("editor-expand-all")).toHaveCount(0);
  await expect(page.getByTestId("picker-options")).toHaveCount(0);
  await importTestHead(page);
  await chooseItem(page, "gear.head", HEAD_ITEM);
  const headInput = pickerInput(slotRow(page, "gear.head"));
  await expect(headInput).toHaveValue(HEAD_ITEM);

  // Undo keeps the menu open, so several steps take one visit.
  await actionsMenu(page).click();
  await expect(action(page, "undo")).toBeEnabled();
  await action(page, "undo").click();
  await expect(headInput).toHaveValue("");
  await expect(action(page, "redo")).toBeEnabled();
  await action(page, "redo").click();
  await expect(headInput).toHaveValue(HEAD_ITEM);

  // Collapsing closes it: the list under it has changed.
  await action(page, "collapse-all").click();
  await expect(action(page, "collapse-all")).toBeHidden();
  // Bodies stay mounted but hidden once collapsed.
  await expect(
    page.getByTestId("section-body").filter({ visible: true }),
  ).toHaveCount(0);

  await actionsMenu(page).click();
  await expect(action(page, "collapse-all")).toBeDisabled();
  await action(page, "expand-all").click();
  await expect(page.getByTestId("section-body").first()).toBeVisible();

  // The picker options toggle in place.
  await actionsMenu(page).click();
  const showCard = action(page, "picker:showCard").locator("input");
  await expect(showCard).toBeChecked();
  await showCard.click();
  await expect(showCard).not.toBeChecked();
});

test("a row's info button opens its item card in a sheet", async ({ page }) => {
  await openBuilder(page);
  const row = slotRow(page, "gear.head");
  await expect(page.getByTestId("slot-info:gear.head")).toHaveCount(0);
  await importTestHead(page);
  await chooseItem(page, "gear.head", HEAD_ITEM);

  await page.getByTestId("slot-info:gear.head").click();
  await expect(sheet(page).getByTestId("item-card-name")).toHaveText(HEAD_ITEM);

  await sheet(page).getByTestId("sheet-close").click();
  await expect(sheet(page)).toHaveCount(0);
  await expect(row).toBeVisible();

  // The backdrop closes it too.
  await page.getByTestId("slot-info:gear.head").click();
  await expect(sheet(page)).toBeVisible();
  await sheet(page).click({ position: { x: 10, y: 10 } });
  await expect(sheet(page)).toHaveCount(0);
});

test("tapping a row does not open the hover card", async ({ page }) => {
  await openBuilder(page);
  await importTestHead(page);
  await chooseItem(page, "gear.head", HEAD_ITEM);
  await blurToHeader(page);

  await page.clock.install();
  // A tap fires the row's `mouseenter` before its click, which is what would arm the card.
  await slotRow(page, "gear.head").locator(".slot-label").hover();
  // Past the hover card's opening delay.
  await page.clock.fastForward(1000);
  await expect(page.getByTestId("item-card")).toHaveCount(0);
});

test.describe("a picked row's info button", () => {
  const MAINHAND = "test-tap-mainhand";
  const MOD = "test-tap-mod";

  /** An artifact mainhand with its nested mod picked, so both rows carry an info button. */
  async function openPickedNestedRow(page: Page) {
    await openBuilder(page);
    await importTestCatalog(page, {
      items: [
        {
          id: MAINHAND,
          name: "Test Tap Mainhand",
          filter: "gear_weapon_mainhand",
          tags: ["artifact:mainhand"],
        },
        { id: MOD, name: "Test Tap Mod", filter: "modification_mainhand" },
      ],
      choices: { "gear.mainhand": MAINHAND, "gear.mainhandMod": MOD },
    });
    await ensureSectionExpanded(page, "gear");
    await expect(
      slotRow(page, "gear.mainhandMod").getByTestId(
        "slot-info:gear.mainhandMod",
      ),
    ).toBeVisible();
  }

  /** The line a row's label sits on, which the info button shares. */
  const labelLine = (page: Page, slotId: string) =>
    slotRow(page, slotId).locator(".slot-label").locator("..");

  test("does not stand the label line taller than an empty row's", async ({
    page,
  }) => {
    // A finger-sized button would make every picked row taller than its neighbors.
    await openPickedNestedRow(page);
    const picked = (await labelLine(page, "gear.mainhand").boundingBox())!;
    const empty = (await labelLine(page, "gear.head").boundingBox())!;
    expect(Math.abs(picked.height - empty.height)).toBeLessThan(4);
  });

  test("leaves a nested row's label level with its guide's elbow", async ({
    page,
  }) => {
    const row = slotRow(page, "gear.mainhandMod");
    await openPickedNestedRow(page);
    const label = (await row.locator(".slot-label").boundingBox())!;
    const elbow = (await row.getByTestId("nest-elbow").boundingBox())!;
    expect(
      Math.abs(label.y + label.height / 2 - (elbow.y + elbow.height / 2)),
    ).toBeLessThanOrEqual(2);
  });

  test("leaves the row's checkbox its whole width to tap", async ({ page }) => {
    // The info button's tap area reaches past its icon; it must not take taps from the
    // checkbox beside it.
    const SLOT = "buffs.elixir";
    await openBuilder(page);
    await importTestCatalog(page, {
      items: [
        {
          id: "test-tap-elixir",
          name: "Test Tap Elixir",
          filter: "consumable_elixir",
        },
      ],
      choices: { [SLOT]: "test-tap-elixir" },
    });
    await ensureSectionExpanded(page, "buffs");
    const checkbox = slotRow(page, SLOT).getByTestId(`slot-toggle:${SLOT}`);
    await expect(
      slotRow(page, SLOT).getByTestId(`slot-info:${SLOT}`),
    ).toBeVisible();
    await checkbox.scrollIntoViewIfNeeded();
    const box = (await checkbox.boundingBox())!;
    for (const x of [box.x + 1, box.x + box.width / 2, box.x + box.width - 1])
      await expect
        .poll(() =>
          page.evaluate(
            ({ x, y }) =>
              document.elementFromPoint(x, y)?.getAttribute("data-testid") ??
              null,
            { x, y: box.y + box.height / 2 },
          ),
        )
        .toBe(`slot-toggle:${SLOT}`);
  });

  test("a list row puts its remove button on the label line, clear of the checkbox", async ({
    page,
  }) => {
    // A phone gives the picker the row's full width, so remove joins the row's other icons:
    // before the checkbox, with info last, and far enough off that a near miss doesn't delete.
    const SLOT = "group.group#1";
    await openBuilder(page);
    await importTestCatalog(page, {
      items: [
        { id: "test-tap-group", name: "Test Tap Group", filter: "group_buff" },
      ],
      choices: { [SLOT]: "test-tap-group" },
    });
    await ensureSectionExpanded(page, "group");
    const row = slotRow(page, SLOT);
    const remove = row.getByTestId(`list-remove:${SLOT}`);
    await remove.scrollIntoViewIfNeeded();
    const removeBox = (await remove.boundingBox())!;
    const checkBox = (await row
      .getByTestId(`slot-toggle:${SLOT}`)
      .boundingBox())!;
    const infoBox = (await row.getByTestId(`slot-info:${SLOT}`).boundingBox())!;
    const pickerBox = (await pickerInput(row).boundingBox())!;

    expect(removeBox.y + removeBox.height).toBeLessThanOrEqual(pickerBox.y + 1);
    expect(removeBox.x + removeBox.width).toBeLessThanOrEqual(checkBox.x);
    expect(checkBox.x + checkBox.width).toBeLessThanOrEqual(infoBox.x);
    await expect
      .poll(() =>
        page.evaluate(
          ({ x, y }) =>
            document.elementFromPoint(x, y)?.getAttribute("data-testid") ??
            null,
          { x: checkBox.x + 1, y: checkBox.y + checkBox.height / 2 },
        ),
      )
      .toBe(`slot-toggle:${SLOT}`);
  });

  test("keeps a finger-sized tap target around the icon", async ({ page }) => {
    await openPickedNestedRow(page);
    const button = slotRow(page, "gear.mainhand").getByTestId(
      "slot-info:gear.mainhand",
    );
    // Hit-testing only sees what is on screen, and a row scrolled in under
    // `content-visibility: auto` joins it once the next frame renders.
    await button.scrollIntoViewIfNeeded();
    const box = (await button.boundingBox())!;
    await expect
      .poll(() =>
        page.evaluate(
          ({ x, y }) =>
            document
              .elementFromPoint(x, y)
              ?.closest('[data-testid^="slot-info:"]')
              ?.getAttribute("data-testid") ?? null,
          { x: box.x - 8, y: box.y + box.height / 2 },
        ),
      )
      .toBe("slot-info:gear.mainhand");
  });
});

test.describe("a point stepper on touch", () => {
  const SLOT = "boons.tier1";
  const ITEM = "test-tap-boon";

  /** Whether a tap `offset` px from one edge of `target`, at its middle height, lands on it.
   *  Measured at the moment of the tap, so a row settling after a scroll is not misread. */
  function takesTapAt(target: Locator, edge: "left" | "right", offset: number) {
    return target.evaluate(
      (el, { edge, offset }) => {
        const box = el.getBoundingClientRect();
        const x = (edge === "left" ? box.left : box.right) + offset;
        const hit = document.elementFromPoint(x, box.top + box.height / 2);
        return !!hit && el.contains(hit);
      },
      { edge, offset },
    );
  }

  async function openStepper(page: Page) {
    await openBuilder(page);
    await importTestCatalog(page, {
      items: [
        {
          id: ITEM,
          name: "Test Tap Boon",
          filter: "boon_tier1",
          inlineRepetition: { min: 0, max: 5, default: 1 },
        },
      ],
    });
    await ensureSectionExpanded(page, "boons");
    const input = slotRow(page, SLOT).getByTestId(`assignment-input-${ITEM}`);
    await input.scrollIntoViewIfNeeded();
    return input;
  }

  test("leaves its input whole to tap, beside the small -/+ buttons", async ({
    page,
  }) => {
    // The buttons draw smaller than a finger and their tap areas reach past them; those
    // areas must stop short of the input between them.
    const input = await openStepper(page);
    await expect.poll(() => takesTapAt(input, "left", 1)).toBe(true);
    await expect.poll(() => takesTapAt(input, "right", -1)).toBe(true);
  });

  test("still catches a tap just past the + button's outer edge", async ({
    page,
  }) => {
    await openStepper(page);
    // The innermost box holding the input is its stepper.
    const stepper = slotRow(page, SLOT)
      .locator("div")
      .filter({ has: page.getByTestId(`assignment-input-${ITEM}`) })
      .last();
    const plus = stepper.getByRole("button", { name: /^Increase/ });
    await expect.poll(() => takesTapAt(plus, "right", 2)).toBe(true);
  });
});
