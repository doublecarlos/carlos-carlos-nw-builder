// Folding a card slides everything below it from where it was, rather than jumping it: the
// next card in the list and, for a nested fold, the rest of the form outside that list too.
// The build editor's sections are covered in motion.spec.ts.
import { test, expect, type Locator } from "@playwright/test";
import { openBuilder, setItemFilter } from "./support/app";
import {
  addBuild,
  addFolder,
  addLayer,
  buildRow,
  buildRowNesting,
  folderRow,
  layerRow,
} from "./support/nav";
import { dragOnto } from "./support/dragDrop";

test.use({ contextOptions: { reducedMotion: "no-preference" } });

/**
 * Clicks `toggle` and checks that each of `targets` starts its slide where it was drawn before.
 * Once every target is carried by a slide, on it or on an ancestor, those slides are set to
 * their first frame and the targets measured, all in one step and polled at frame pace, since
 * a slide lasts only a moment. The toggle is scrolled into view first, since the click would
 * otherwise scroll after the positions were taken.
 */
async function startsWhereItWas(toggle: Locator, targets: Locator[]) {
  await toggle.scrollIntoViewIfNeeded();
  const before: number[] = [];
  for (const target of targets) before.push((await target.boundingBox())!.y);
  const elements = await Promise.all(
    targets.map(async (target) => (await target.elementHandle())!),
  );
  await toggle.click();

  let drawnAtStart: number[] | null = null;
  await expect
    .poll(
      async () => {
        drawnAtStart = await toggle.page().evaluate((els) => {
          const slides = els.map((el) => {
            for (
              let node: Element | null = el;
              node;
              node = node.parentElement
            ) {
              const slide = node
                .getAnimations()
                .find((a) => a.id === "row-slide");
              if (slide) return slide;
            }
            return null;
          });
          if (slides.some((slide) => !slide)) return null;
          for (const slide of slides) slide!.currentTime = 0;
          return els.map((el) => el.getBoundingClientRect().top);
        }, elements);
        return drawnAtStart !== null;
      },
      { intervals: [16] },
    )
    .toBe(true);
  drawnAtStart!.forEach((top, i) =>
    expect(Math.abs(top - before[i])).toBeLessThan(2),
  );
}

test("folding a grant slides the next grant and the form below the list", async ({
  page,
}) => {
  await openBuilder(page);
  await addLayer(page);
  await layerRow(page, "Layer 1").locator(".nav-name").click();
  await page.getByRole("button", { name: /Bonuses \d+/ }).click();
  await page.getByTestId("new-bonus").click();
  const addGrant = page.getByLabel("Add grant");
  await addGrant.click();
  await addGrant.click();
  const grants = page.getByTestId("bonus-grant-row");
  await expect(grants.nth(0)).toHaveAttribute("data-expanded", "true");

  await startsWhereItWas(grants.nth(0).getByTestId("grant-toggle"), [
    grants.nth(1),
    page.getByText("Stacking", { exact: true }),
  ]);
});

test("folding an item's bonus card slides the add row below the list", async ({
  page,
}) => {
  await openBuilder(page);
  await addLayer(page);
  await layerRow(page, "Layer 1").locator(".nav-name").click();
  await page.getByTestId("new-item").click();
  await page.getByTestId("item-name-input").fill("ZZZ Fold Item");
  await setItemFilter(page, "gear_head");
  await page.getByLabel("Add bonus").click();
  const card = page.getByTestId("bonus-card").first();
  await card.getByTestId("bonus-name-input").fill("ZZZ Fold Bonus");
  await page.getByRole("button", { name: "Save bonus" }).click();
  await expect(card).toHaveAttribute("data-expanded", "true");

  await startsWhereItWas(card.getByTestId("bonus-card-toggle"), [
    page.getByLabel("Add bonus"),
  ]);
});

test("folding a nav folder slides the row below it", async ({ page }) => {
  await openBuilder(page);
  await addBuild(page);
  await addFolder(page);
  await addFolder(page);
  await dragOnto(
    buildRow(page, "Build 1"),
    folderRow(page, "Folder 1"),
    "into",
  );
  await expect(buildRowNesting(page, "Build 1")).toHaveAttribute("data-nested");
  // The drop's own reorder slide has to end before positions are taken.
  await expect
    .poll(() =>
      page.evaluate(() =>
        document.getAnimations().some((a) => a.id === "row-slide"),
      ),
    )
    .toBe(false);

  await startsWhereItWas(folderRow(page, "Folder 1").locator(".nav-name"), [
    folderRow(page, "Folder 2"),
  ]);
});

test("folding a stable card slides the card below it", async ({ page }) => {
  await page.goto("/?stable=mount");
  const cards = page.getByTestId("stable-group-card");
  await expect(cards.nth(1)).toBeVisible();

  await startsWhereItWas(cards.nth(0).getByTestId(/^stable-card-toggle:/), [
    cards.nth(1),
  ]);
});
