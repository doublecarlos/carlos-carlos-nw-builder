// Condition trees on a phone: each condition is one line of summary text, tapping it opens that
// condition alone in a bottom sheet with its fields stacked, and groups are slim labeled blocks
// so three levels still fit (checked in layout-sweep.spec.ts). Driven through two hosts: a bonus grant's "Active when" and a
// slot's "Available when".
import { test, expect, type Locator, type Page } from "@playwright/test";
import { pickerScreen } from "../support/app";
import { confirmDialog, openNewLayer } from "../support/nav";
import { center, touchDrag } from "../support/touch";
import { requireBox } from "../support/dragDrop";
import { MIN_SUPPORTED_WIDTH } from "../support/viewport";

const form = (page: Page) => page.getByTestId("layer-form-pane");
const editor = (page: Page) => page.getByTestId("condition-editor");
const summaries = (scope: Locator) =>
  scope.getByTestId("condition-summary-text");
const done = (page: Page) => page.getByTestId("condition-editor-done");

/** A new bonus with one grant; returns that grant's condition tree. */
async function openBonusConditions(page: Page): Promise<Locator> {
  await openNewLayer(page);
  await page.getByTestId("tab-bonuses").tap();
  await page.getByTestId("new-bonus").tap();
  await page.getByLabel("Add grant").tap();
  return form(page);
}

/** The shipped Arms slot, its "Available when" seeded from `when` through the JSON field. */
async function openSlotConditions(page: Page, when: object): Promise<Locator> {
  await openNewLayer(page);
  await page.getByTestId("tab-slots").tap();
  await page.locator(".editor-search").fill("Arms");
  await page.locator(".editor-row", { hasText: "Arms" }).first().tap();
  await page.getByTestId("slot-when-json-toggle").tap();
  await page.getByTestId("slot-when-json").fill(JSON.stringify(when));
  await page.getByTestId("slot-when-json-toggle").tap();
  return page.getByTestId("slot-when");
}

/** The "+" at the foot of `list`'s own rows, not of a nested branch's. */
async function addFrom(foot: Locator, what: "leaf" | "all" | "any" | "not") {
  await foot.getByTestId("condition-add").tap();
  await foot.page().getByTestId(`condition-add-${what}`).tap();
}

/** The trailing "+" of the outermost list, which follows every nested one in DOM order. */
const rootFoot = (scope: Locator) =>
  scope.getByTestId("condition-empty-drop").last();

for (const width of [MIN_SUPPORTED_WIDTH, 412]) {
  test.describe(`at ${width}px`, () => {
    test.beforeEach(async ({ page }) => {
      await page.setViewportSize({ width, height: 800 });
    });

    test("each condition reads as one summary line, and its editor edits it", async ({
      page,
    }) => {
      const tree = await openSlotConditions(page, {
        toggle: "combat",
        class: "wizard",
        enemies: { atLeast: 2, below: 5 },
      });
      await expect(summaries(tree)).toHaveText([
        "combat enabled",
        "Class: wizard",
        "enemies 2 to 5",
      ]);
      // The inline controls are gone on a phone.
      await expect(tree.getByTestId("picker-input")).toHaveCount(0);

      await tree.getByTestId("condition-summary").nth(2).tap();
      await expect(editor(page)).toBeVisible();
      await expect(editor(page).getByTestId("sheet-panel")).toBeInViewport({
        ratio: 1,
      });
      const fields = editor(page).getByTestId("condition-editor-fields");
      await expect(fields.getByTestId("picker-input").first()).toHaveValue(
        "enemies",
      );

      // FormField labels are plain text, so the range inputs go by order: At least, Below.
      await fields.locator("input[type=number]").first().fill("3");
      await done(page).tap();
      await expect(editor(page)).toHaveCount(0);
      await expect(summaries(tree).nth(2)).toHaveText("enemies 3 to 5");
    });

    test("a condition added from the + opens straight in the editor", async ({
      page,
    }) => {
      const tree = await openBonusConditions(page);
      await addFrom(rootFoot(tree), "leaf");
      await expect(editor(page)).toBeVisible();
      await done(page).tap();

      // Untouched, it still reads as what it is, flagged as unfinished.
      const line = tree.getByTestId("condition-summary");
      await expect(line).toHaveCount(1);
      await expect(line).toHaveAttribute("data-incomplete", "");
      await expect(line).toContainText("toggle");
      await expect(line).toContainText("incomplete");
    });
  });
}

test.describe("at the narrowest width", () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: MIN_SUPPORTED_WIDTH, height: 740 });
  });

  test("a picker in the editor opens full-screen, and Back closes it, then the editor", async ({
    page,
  }) => {
    const tree = await openBonusConditions(page);
    await addFrom(rootFoot(tree), "leaf");
    const fields = editor(page).getByTestId("condition-editor-fields");

    await fields.getByTestId("picker-input").first().tap();
    await expect(pickerScreen(page)).toBeVisible();
    await pickerScreen(page)
      .getByTestId("picker-option")
      .filter({ hasText: /^class$/ })
      .tap();
    await expect(pickerScreen(page)).toHaveCount(0);
    await expect(fields.getByTestId("picker-input").first()).toHaveValue(
      "class",
    );

    // Back closes the picker on top first, leaving the editor open.
    await fields.getByTestId("picker-input").first().tap();
    await expect(pickerScreen(page)).toBeVisible();
    await page.goBack();
    await expect(pickerScreen(page)).toHaveCount(0);
    await expect(editor(page)).toBeVisible();

    // Then the editor itself, without leaving the form or asking to discard it.
    await page.goBack();
    await expect(editor(page)).toHaveCount(0);
    await expect(confirmDialog(page)).toHaveCount(0);
    await expect(page.getByTestId("layer-form-back")).toBeVisible();
    await expect(summaries(tree)).toHaveText(["class"]);
  });

  test("a value typed in the editor shows in the summary once closed", async ({
    page,
  }) => {
    const tree = await openBonusConditions(page);
    await addFrom(rootFoot(tree), "leaf");
    const fields = editor(page).getByTestId("condition-editor-fields");
    await fields.getByTestId("picker-input").first().tap();
    await pickerScreen(page)
      .getByTestId("picker-option")
      .filter({ hasText: /^equipped$/ })
      .tap();
    await fields.locator("input[list=nw-tags]").fill("aura");
    await done(page).tap();
    await expect(summaries(tree)).toHaveText(['1× item tagged "aura"']);
    await expect(tree.getByTestId("condition-summary")).not.toHaveAttribute(
      "data-incomplete",
    );
  });

  test("Delete in the editor removes that condition only", async ({ page }) => {
    const tree = await openSlotConditions(page, {
      toggle: "combat",
      class: "wizard",
    });
    await tree.getByTestId("condition-summary").first().tap();
    await page.getByTestId("condition-editor-delete").tap();
    await expect(editor(page)).toHaveCount(0);
    await expect(summaries(tree)).toHaveText(["Class: wizard"]);
    await expect(confirmDialog(page)).toHaveCount(0);
  });

  test("a nested group is added from the +, and its own + adds inside it", async ({
    page,
  }) => {
    const tree = await openBonusConditions(page);
    await addFrom(rootFoot(tree), "any");
    await expect(tree.getByTestId("condition-op-label")).toHaveText(["any of"]);
    const branches = tree.getByTestId("condition-branch");
    await expect(branches).toHaveCount(2);

    await addFrom(branches.nth(1).getByTestId("condition-empty-drop"), "leaf");
    await expect(editor(page)).toBeVisible();
    await done(page).tap();
    await expect(branches.nth(1).getByTestId("condition-summary")).toHaveCount(
      1,
    );
    await expect(branches.nth(0).getByTestId("condition-summary")).toHaveCount(
      0,
    );

    // The group's own actions stay reachable.
    await addFrom(branches.nth(0).getByTestId("condition-empty-drop"), "not");
    await expect(tree.getByTestId("condition-op-label")).toHaveText([
      "any of",
      "not",
    ]);
    await tree
      .getByTestId("condition-row")
      .first()
      .getByRole("button", { name: "Insert branch" })
      .first()
      .tap();
    await expect(branches).toHaveCount(4);
  });

  test("a condition reorders by dragging its grip with a finger", async ({
    page,
  }) => {
    const tree = await openSlotConditions(page, {
      toggle: "combat",
      class: "wizard",
      enemies: { atLeast: 2 },
    });
    const rows = tree.getByTestId("condition-row");
    // Clear of the scroller's edges, where a drag autoscrolls.
    await rows.nth(1).evaluate((el) => el.scrollIntoView({ block: "center" }));
    const grip = (i: number) =>
      rows.nth(i).getByTestId("condition-drag-handle");

    // The last one to the top.
    const first = await requireBox(rows.nth(0));
    await touchDrag(page, await center(grip(2)), {
      x: first.x + first.width / 2,
      y: first.y + 6,
    });
    await expect(summaries(tree)).toHaveText([
      "enemies ≥ 2",
      "combat enabled",
      "Class: wizard",
    ]);

    // Then the top one past the next.
    const second = await center(rows.nth(1));
    await touchDrag(page, await center(grip(0)), {
      ...second,
      y: second.y + 12,
    });
    await expect(summaries(tree)).toHaveText([
      "combat enabled",
      "enemies ≥ 2",
      "Class: wizard",
    ]);
    // The drag opened nothing.
    await expect(editor(page)).toHaveCount(0);
  });

  test("a condition moves into a group's branch by its grip", async ({
    page,
  }) => {
    // The bonus form, whose trees take a condition dropped across branches.
    const tree = await openBonusConditions(page);
    await addFrom(rootFoot(tree), "leaf");
    await done(page).tap();
    await addFrom(rootFoot(tree), "any");
    const branch = tree.getByTestId("condition-branch").first();
    await expect(summaries(branch)).toHaveCount(0);

    // Both ends on screen at once, read without scrolling either away.
    const rows = tree.getByTestId("condition-row");
    await rows.nth(1).evaluate((el) => el.scrollIntoView({ block: "center" }));
    const at = async (target: Locator) => {
      const box = (await target.boundingBox())!;
      return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    };
    await touchDrag(
      page,
      await at(rows.first().getByTestId("condition-drag-handle")),
      await at(branch.getByTestId("condition-empty-drop")),
    );

    await expect(summaries(branch)).toHaveText(["toggle"]);
    await expect(summaries(tree)).toHaveCount(1);
    await expect(rows.first()).toContainText("any of");
  });
});
