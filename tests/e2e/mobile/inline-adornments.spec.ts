// A button sitting inside a field grows to a tap target on a coarse pointer, and the field's
// text must still clear it rather than run underneath.
import { test, expect, type Locator, type Page } from "@playwright/test";
import { ensureSectionExpanded, openBuilder } from "../support/app";
import { addLayer, layerRow } from "../support/nav";
import { MIN_SUPPORTED_WIDTH } from "../support/viewport";

test.use({ viewport: { width: MIN_SUPPORTED_WIDTH, height: 740 } });

async function openDrawer(page: Page) {
  const drawer = page.getByTestId("nav-drawer");
  if (!(await drawer.isVisible()))
    await page.getByTestId("header-nav-toggle").click();
  await expect(drawer).toBeVisible();
}

/** Where the field's text starts and ends: inside its border and padding. */
async function textArea(field: Locator) {
  return field.evaluate((el) => {
    const box = el.getBoundingClientRect();
    const style = getComputedStyle(el);
    return {
      left:
        box.left +
        parseFloat(style.borderLeftWidth) +
        parseFloat(style.paddingLeft),
      right:
        box.right -
        parseFloat(style.borderRightWidth) -
        parseFloat(style.paddingRight),
    };
  });
}

test("the formula reference toggle stays clear of the formula text", async ({
  page,
}) => {
  await openBuilder(page);
  await openDrawer(page);
  await addLayer(page);
  await openDrawer(page);
  await layerRow(page, "Layer 1").locator(".nav-name").click();
  await page.getByTestId("tab-bonuses").tap();
  await page.getByTestId("new-bonus").tap();
  await page.getByLabel("Add grant").tap();

  const field = page.getByTestId("grant-scale");
  await field.fill("occurrences()");
  const toggle = page.getByTestId("grant-scale-reference-toggle");
  const toggleBox = (await toggle.boundingBox())!;
  expect(toggleBox.width).toBeGreaterThanOrEqual(40);
  const iconBox = (await toggle.locator("svg").boundingBox())!;
  const text = await textArea(field);
  expect(iconBox.x + iconBox.width).toBeLessThanOrEqual(text.left);
  expect(toggleBox.x + toggleBox.width).toBeLessThanOrEqual(text.left + 1);
});

test("a filter's clear button stays clear of the filter text", async ({
  page,
}) => {
  await openBuilder(page);
  await ensureSectionExpanded(page, "insignia");
  await page.getByTestId("open-stable-browser:insignia.mount1").click();
  const field = page.getByTestId("stable-filter");
  await field.fill("a long filter text that runs to the end");

  const clear = page.getByTestId("stable-filter-clear");
  const clearBox = (await clear.boundingBox())!;
  expect(clearBox.width).toBeGreaterThanOrEqual(40);
  const text = await textArea(field);
  expect(text.right).toBeLessThanOrEqual(clearBox.x + 1);
});
