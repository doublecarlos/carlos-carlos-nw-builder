// The build editor on a phone: a row stacks its label over its control, the toolbar's actions
// live in an overflow menu, and the item card opens from a button instead of on hover. Fit at
// phone widths is checked in layout-sweep.spec.ts.
import { test, expect, type Page } from "@playwright/test";
import {
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
  await page.getByTestId("app-header").click({ position: { x: 4, y: 4 } });

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
