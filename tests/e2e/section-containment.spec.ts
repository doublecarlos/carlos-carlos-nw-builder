// Off-screen section bodies skip rendering (`content-visibility: auto`). A go-to jump still
// lands its row on screen below its header, and sticky headers still pin.
import { test, expect, type Page } from "@playwright/test";
import {
  cursorKey,
  expandAllSections,
  headerRow,
  openBuilder,
  slotRow,
} from "./support/app";

async function jumpTo(page: Page, query: string, slotId: string) {
  await page.keyboard.press("ControlOrMeta+k");
  await page.getByTestId("go-to-input").fill(query);
  await page.getByTestId(`go-to-option-slot:${slotId}`).click();
}

/** How far the row's top sits below its own section's header; negative is underneath it. */
const clearanceUnderHeader = (page: Page, slotId: string, sectionId: string) =>
  page.evaluate(
    ([slot, section]) => {
      const row = document
        .querySelector(`[data-cursor-key="slot:${slot}"]`)!
        .getBoundingClientRect();
      const header = document
        .querySelector(`[data-cursor-key="header:${section}"]`)!
        .getBoundingClientRect();
      return Math.round(row.top - header.bottom);
    },
    [slotId, sectionId],
  );

for (const [query, slotId, sectionId] of [
  ["Insignia 5.4", "insignia.insignia5_4", "insignia"],
  ["Daily damage", "scalers.dailyDamage", "scalers"],
]) {
  test(`a jump to ${slotId} on a fresh load lands it on screen, below its header`, async ({
    page,
  }) => {
    await openBuilder(page);
    await expandAllSections(page);

    await jumpTo(page, query, slotId);

    await expect.poll(() => cursorKey(page)).toBe(`slot:${slotId}`);
    await expect(slotRow(page, slotId)).toBeInViewport({ ratio: 1 });
    await expect
      .poll(() => clearanceUnderHeader(page, slotId, sectionId))
      .toBeGreaterThanOrEqual(0);
  });
}

test("a section header stays pinned while its body scrolls under it", async ({
  page,
}) => {
  await openBuilder(page);
  await expandAllSections(page);
  const header = headerRow(page, "insignia");
  await header.scrollIntoViewIfNeeded();
  const editor = page.getByTestId("editor-column");
  const pinnedAt = await editor.evaluate(
    (el) => el.getBoundingClientRect().top + el.clientTop,
  );

  // Halfway down a long body: the header has reached the editor's top edge and stays there.
  await slotRow(page, "insignia.insignia3_2").evaluate((row) =>
    row.scrollIntoView({ block: "center" }),
  );
  await expect
    .poll(async () => Math.abs((await header.boundingBox())!.y - pinnedAt))
    .toBeLessThan(2);
  await expect(header).toBeInViewport();
});
