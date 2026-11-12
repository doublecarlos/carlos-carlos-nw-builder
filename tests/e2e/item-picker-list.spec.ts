// End-to-end coverage for the `item_picker_list` slot type: rows are added, removed and
// reordered from the build editor, and a removal closes the gap rather than leaving a hole. `misc.misc` is the
// shipped list used throughout, picking from a test item.
import { test, expect, type Page } from "@playwright/test";
import {
  openBuilder,
  slotRow,
  pickerInput,
  chooseItem,
  addListRows,
  listAddButton,
  chooseCombo,
} from "./support/app";
import { shippedSlotLabel } from "./support/shippedData";
import { storedBuilds } from "./support/storage";
import { beginDrag, dragOnto } from "./support/dragDrop";
import { importTestCatalog } from "./support/testCatalog";

const LIST = "misc.misc";
const LABEL = shippedSlotLabel(LIST);
const row = (index: number) => `${LIST}#${index}`;

const BUILD = "Test misc list";
const MISC_ITEM = {
  id: "test-misc-item",
  name: "Test Misc Item",
  filter: "misc",
};

/** A build with the test item among the list's candidates. */
async function openWithMiscItem(page: Page) {
  await openBuilder(page);
  await importTestCatalog(page, { name: BUILD, items: [MISC_ITEM] });
}

test("a fresh build shows the add button and no rows", async ({ page }) => {
  await openBuilder(page);

  await expect(listAddButton(page, LIST)).toBeVisible();
  await expect(slotRow(page, row(1))).toHaveCount(0);
});

test("adding rows numbers them after the slot's label", async ({ page }) => {
  await openBuilder(page);
  await addListRows(page, LIST, 2);

  await expect(slotRow(page, row(1))).toContainText(`${LABEL} 1`);
  await expect(slotRow(page, row(2))).toContainText(`${LABEL} 2`);
  await expect(slotRow(page, row(3))).toHaveCount(0);
});

test("each row picks independently from the list's own candidates", async ({
  page,
}) => {
  await openWithMiscItem(page);
  await addListRows(page, LIST, 2);

  const first = MISC_ITEM.name;
  await chooseItem(page, row(1), first);

  await expect(pickerInput(slotRow(page, row(1)))).toHaveValue(first);
  await expect(pickerInput(slotRow(page, row(2)))).toHaveValue("");
});

test("removing a row closes the gap under it", async ({ page }) => {
  await openWithMiscItem(page);
  await addListRows(page, LIST, 2);

  const kept = MISC_ITEM.name;
  await chooseItem(page, row(2), kept);

  await slotRow(page, row(1))
    .getByTestId(`list-remove:${row(1)}`)
    .click();

  // One row left, holding what row 2 held.
  await expect(slotRow(page, row(2))).toHaveCount(0);
  await expect(pickerInput(slotRow(page, row(1)))).toHaveValue(kept);
});

/** The picks of the list's first `count` rows, in order. */
async function picks(page: Page, count: number) {
  const values: string[] = [];
  for (let i = 1; i <= count; i += 1)
    values.push(await pickerInput(slotRow(page, row(i))).inputValue());
  return values;
}

test("dragging a row by its grip moves its pick there", async ({ page }) => {
  await openWithMiscItem(page);
  await addListRows(page, LIST, 3);
  await chooseItem(page, row(1), MISC_ITEM.name);

  await dragOnto(
    page.getByTestId(`list-drag:${row(1)}`),
    slotRow(page, row(3)),
    "after",
  );

  await expect.poll(() => picks(page, 3)).toEqual(["", "", MISC_ITEM.name]);
  // The cursor lands on the row dragged, not on the row now in its old place.
  await expect(
    slotRow(page, row(3)).locator("[data-cursor-anchor]"),
  ).toBeFocused();
});

// A hover card left over the rows would take the drop, so a drag closes it.
test("starting a drag closes the row's hover card", async ({ page }) => {
  await openWithMiscItem(page);
  await addListRows(page, LIST, 2);
  await chooseItem(page, row(1), MISC_ITEM.name);
  const card = page.getByTestId("item-card");
  await slotRow(page, row(1)).getByText(`${LABEL} 1`).hover();
  await expect(card).toBeVisible();

  const drag = await beginDrag(page.getByTestId(`list-drag:${row(1)}`));
  await expect(card).toBeHidden();
  await drag.end();
});

// Alt+arrow is the keyboard's way to reorder, and the cursor stays on the row it moved.
test("Alt+arrow moves the row under the cursor and keeps the cursor on it", async ({
  page,
}) => {
  await openWithMiscItem(page);
  await addListRows(page, LIST, 3);
  await chooseItem(page, row(1), MISC_ITEM.name);
  await slotRow(page, row(1)).locator("[data-cursor-anchor]").focus();

  await page.keyboard.press("Alt+ArrowDown");

  await expect.poll(() => picks(page, 3)).toEqual(["", MISC_ITEM.name, ""]);
  await expect(
    slotRow(page, row(2)).locator("[data-cursor-anchor]"),
  ).toBeFocused();

  // Already first: the row stays where it is.
  await page.keyboard.press("Alt+ArrowUp");
  await page.keyboard.press("Alt+ArrowUp");
  await expect.poll(() => picks(page, 3)).toEqual([MISC_ITEM.name, "", ""]);
});

test("a hand-authored item_picker row has no grip", async ({ page }) => {
  await openBuilder(page);
  await expect(
    slotRow(page, "gear.head").getByTestId(/^list-drag:/),
  ).toHaveCount(0);
});

test.describe("with motion", () => {
  test.use({ contextOptions: { reducedMotion: "no-preference" } });

  /** Row slot ids whose row is sliding right now. */
  function sliding(page: Page) {
    return page.evaluate(() =>
      [...document.querySelectorAll<HTMLElement>("[data-flip-key]")]
        .filter((el) => el.getAnimations().some((a) => a.id === "row-slide"))
        .map((el) => el.dataset.cursorKey),
    );
  }

  // A moved row slides from where it was, and the one it displaced slides the other way.
  test("moving a row slides it and the row it swapped with", async ({
    page,
  }) => {
    await openWithMiscItem(page);
    await addListRows(page, LIST, 3);
    await slotRow(page, row(2)).locator("[data-cursor-anchor]").focus();

    await page.keyboard.press("Alt+ArrowUp");

    await expect
      .poll(async () => (await sliding(page)).sort(), { intervals: [16] })
      .toEqual([`slot:${row(1)}`, `slot:${row(2)}`]);
  });

  // A removed row goes at once, and the rows below close the gap by sliding up.
  test("removing a row slides the rows below it up", async ({ page }) => {
    await openWithMiscItem(page);
    await addListRows(page, LIST, 3);
    await expect.poll(() => sliding(page)).toEqual([]);

    await page.getByTestId(`list-remove:${row(1)}`).click();

    await expect
      .poll(async () => (await sliding(page)).sort(), { intervals: [16] })
      .toEqual([`slot:${row(1)}`, `slot:${row(2)}`]);
  });
});

test("an empty row survives a save and reload", async ({ page }) => {
  await openWithMiscItem(page);
  await addListRows(page, LIST, 3);
  await chooseItem(page, row(1), MISC_ITEM.name);

  await expect
    .poll(async () => {
      const build = (await storedBuilds(page)).find((b) => b.name === BUILD);
      return [build?.listRows[LIST], build?.choices[row(1)]];
    })
    .toEqual([3, MISC_ITEM.id]);
  await page.reload();

  await expect(slotRow(page, row(3))).toBeVisible();
  await expect(pickerInput(slotRow(page, row(3)))).toHaveValue("");
});

test("a hand-authored item_picker row has no remove button", async ({
  page,
}) => {
  await openBuilder(page);

  await expect(
    slotRow(page, "gear.head").getByTestId(/^list-remove:/),
  ).toHaveCount(0);
});

test.describe("comparing against a build with more rows", () => {
  /** A one-row build compared against the two-row first build. */
  async function compareWithLongerList(page: Page) {
    await openWithMiscItem(page);
    await addListRows(page, LIST, 2);
    await chooseItem(page, row(1), MISC_ITEM.name);
    await chooseItem(page, row(2), MISC_ITEM.name);

    await page.getByTestId("nav-add-build").click();
    await addListRows(page, LIST, 1);
    await chooseItem(page, row(1), MISC_ITEM.name);
    await chooseCombo(page.locator(".compare-select"), BUILD);
  }

  const extraRow = (page: Page) => page.getByTestId(`compare-only:${row(2)}`);

  // The row only the compare build has is a change; without its own row it would read as
  // "no difference".
  test("highlighting changes shows the compare build's extra row", async ({
    page,
  }) => {
    await compareWithLongerList(page);
    await expect(extraRow(page)).toHaveCount(0);

    await page.getByRole("checkbox", { name: "Highlight changes" }).check();
    await expect(extraRow(page)).toHaveAttribute("data-diff");
    await expect(extraRow(page)).toHaveAttribute("data-reason", "extraRow");
    await expect(extraRow(page)).toContainText(`${BUILD}: ${MISC_ITEM.name}`);
    await expect(extraRow(page).locator("input")).toHaveCount(0);
  });

  test("only showing changes keeps the extra row", async ({ page }) => {
    await compareWithLongerList(page);
    await page.getByRole("checkbox", { name: "Only show changes" }).check();

    await expect(extraRow(page)).toBeVisible();
    await expect(slotRow(page, row(1))).toBeHidden();
  });

  // Applying the extra row adds it here with the compare build's pick, so it stops differing.
  test("applying the extra row adds it with the compare build's pick", async ({
    page,
  }) => {
    await compareWithLongerList(page);
    await page.getByRole("checkbox", { name: "Highlight changes" }).check();
    await extraRow(page).getByTestId("compare-only-apply").click();

    await expect(extraRow(page)).toHaveCount(0);
    await expect(pickerInput(slotRow(page, row(2)))).toHaveValue(
      MISC_ITEM.name,
    );
    await expect(slotRow(page, row(2))).not.toHaveAttribute("data-diff");
  });

  // Enter on the extra row applies it and the cursor stays on the row it became.
  test("Enter on the extra row applies it and keeps the cursor", async ({
    page,
  }) => {
    await compareWithLongerList(page);
    await page.getByRole("checkbox", { name: "Highlight changes" }).check();
    await slotRow(page, row(1)).locator("[data-cursor-anchor]").focus();
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");

    await expect(pickerInput(slotRow(page, row(2)))).toHaveValue(
      MISC_ITEM.name,
    );
    await expect(
      slotRow(page, row(2)).locator("[data-cursor-anchor]"),
    ).toBeFocused();
  });

  // Adding the row in this build turns the read-only row into an ordinary, editable one.
  test("adding the row replaces the read-only one", async ({ page }) => {
    await compareWithLongerList(page);
    await page.getByRole("checkbox", { name: "Highlight changes" }).check();
    await listAddButton(page, LIST).click();

    await expect(extraRow(page)).toHaveCount(0);
    await expect(pickerInput(slotRow(page, row(2)))).toHaveValue("");
  });
});
