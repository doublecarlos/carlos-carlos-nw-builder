// An undo or redo shows what it changed: the changed rows are ringed, the topmost is scrolled
// into view, and a collapsed section holding one opens. Reduced motion keeps the ring, since
// it is the only cue for what changed.
import { test, expect, type Page } from "@playwright/test";
import {
  openBuilder,
  chooseItem,
  slotRow,
  headerRow,
  undoButton,
  openSectionActions,
} from "./support/app";
import { shippedItemName } from "./support/shippedData";

const HEAD_ITEM = shippedItemName("m29-enchanted-depthweave-cap-ca");
const ARMS_ITEM = shippedItemName("m31-bindings-of-the-death-pact-damage");

/** The cursor keys of the rows ringed right now. */
function ringed(page: Page) {
  return page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>("[data-cursor-key]")]
      .filter((row) => row.getAnimations().some((a) => a.id === "row-ring"))
      .map((row) => row.dataset.cursorKey!),
  );
}

/** Polled at frame pace: a ring lasts well under a second. */
async function expectRinged(page: Page, keys: string[]) {
  await expect
    .poll(async () => (await ringed(page)).sort(), { intervals: [16] })
    .toEqual([...keys].sort());
}

async function scrollEditorToBottom(page: Page) {
  await page
    .getByTestId("editor-column")
    .evaluate((el) => (el.scrollTop = el.scrollHeight));
}

test.describe("with motion", () => {
  test.use({ contextOptions: { reducedMotion: "no-preference" } });

  test("undo rings the changed row and scrolls it into view", async ({
    page,
  }) => {
    await openBuilder(page);
    await chooseItem(page, "gear.head", HEAD_ITEM);
    await scrollEditorToBottom(page);
    await expect(slotRow(page, "gear.head")).not.toBeInViewport();

    await undoButton(page).click();
    await expectRinged(page, ["slot:gear.head"]);
    await expect(slotRow(page, "gear.head")).toBeInViewport();
  });

  test("redo shows its change the same way", async ({ page }) => {
    await openBuilder(page);
    await chooseItem(page, "gear.head", HEAD_ITEM);
    await undoButton(page).click();
    await expectRinged(page, ["slot:gear.head"]);
    await scrollEditorToBottom(page);

    await page.getByTestId("editor-redo").click();
    await expectRinged(page, ["slot:gear.head"]);
    await expect(slotRow(page, "gear.head")).toBeInViewport();
  });

  test("an undo of several rows rings them all", async ({ page }) => {
    await openBuilder(page);
    await chooseItem(page, "gear.head", HEAD_ITEM);
    await chooseItem(page, "gear.arms", ARMS_ITEM);
    await openSectionActions(page, "gear");
    await page.getByTestId("clear-section-gear").click();

    await undoButton(page).click();
    await expectRinged(page, ["slot:gear.head", "slot:gear.arms"]);
    // The topmost of them is the one scrolled to.
    await expect(slotRow(page, "gear.head")).toBeInViewport();
  });

  test("undo opens a collapsed section holding the change", async ({
    page,
  }) => {
    await openBuilder(page);
    await chooseItem(page, "gear.head", HEAD_ITEM);
    await headerRow(page, "gear").click();
    await expect(headerRow(page, "gear")).toHaveAttribute(
      "aria-expanded",
      "false",
    );

    await undoButton(page).click();
    await expect(headerRow(page, "gear")).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    await expect(slotRow(page, "gear.head")).toBeInViewport();
  });
});

test("reduced motion still rings and scrolls to the change", async ({
  page,
}) => {
  await openBuilder(page);
  await chooseItem(page, "gear.head", HEAD_ITEM);
  await scrollEditorToBottom(page);

  await undoButton(page).click();
  await expectRinged(page, ["slot:gear.head"]);
  await expect(slotRow(page, "gear.head")).toBeInViewport();
});
