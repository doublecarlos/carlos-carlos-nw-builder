// End-to-end coverage for drag reordering in the Slots tab outline: slots within and across
// sections, and sections. Each drop is one undo step.
//
// Cross-section drags filter the outline to "bolster", leaving four rows so both ends of a
// drag are on screen.
import { test, expect, type Page } from "@playwright/test";
import { openBuilder } from "./support/app";
import { dragOnto } from "./support/dragDrop";
import { openSlotsTab } from "./support/layerEditor";
import { addLayer, layerRow } from "./support/nav";

const COMPANION_BOLSTER = "companions.bolster";
const MOUNT_BOLSTER = "mounts.bolster";

/** Creates a layer, selects it, and opens the Slots tab. */
async function openSlotsFor(page: Page) {
  await addLayer(page);
  await layerRow(page, "Layer 1").locator(".nav-name").click();
  await openSlotsTab(page);
}

/** Switches back from the layer editor to the first build. */
async function backToBuild(page: Page) {
  await page
    .getByTestId("library")
    .locator(".nav-row--build")
    .first()
    .locator(".nav-name")
    .click();
  await expect(page.getByTestId("builder-content")).toBeVisible();
}

const outlineRow = (page: Page, kind: "slot" | "section", key: string) =>
  page.locator(`[data-outline-key="${kind}:${key}"]`);

const handleOf = (row: ReturnType<typeof outlineRow>) =>
  row.getByTestId("outline-handle");

/** Every row of the outline, top to bottom, by its own key: the authored order as rendered. */
const outlineOrder = (page: Page) =>
  page
    .locator("[data-outline-key]")
    .evaluateAll((rows) =>
      rows.map((row) => row.getAttribute("data-outline-key")),
    );

/** The build editor's own slot order within one section. */
const sectionSlotOrder = (page: Page, sectionId: string) =>
  page
    .locator(`[data-section-id="${sectionId}"] [data-cursor-key^="slot:"]`)
    .evaluateAll((rows) =>
      rows.map((row) => row.getAttribute("data-cursor-key")),
    );

test("dragging a slot past its neighbor reorders it within the section", async ({
  page,
}) => {
  await openBuilder(page);
  await openSlotsFor(page);

  const classRow = outlineRow(page, "slot", "options.class");
  const paragonRow = outlineRow(page, "slot", "options.paragon");
  await dragOnto(handleOf(classRow), paragonRow, "after");

  await expect.poll(() => outlineOrder(page)).toContain("slot:options.paragon");
  const order = await outlineOrder(page);
  expect(order.indexOf("slot:options.paragon")).toBeLessThan(
    order.indexOf("slot:options.class"),
  );

  await backToBuild(page);
  const rendered = await sectionSlotOrder(page, "options");
  expect(rendered.indexOf("slot:options.paragon")).toBeLessThan(
    rendered.indexOf("slot:options.class"),
  );
});

test("one drop is one undo step", async ({ page }) => {
  await openBuilder(page);
  await openSlotsFor(page);

  const classRow = outlineRow(page, "slot", "options.class");
  await dragOnto(
    handleOf(classRow),
    outlineRow(page, "slot", "options.paragon"),
    "after",
  );

  const undo = page.getByTestId("editor-undo");
  await expect(undo).toBeEnabled();
  await undo.hover();
  await expect(page.getByTestId("tooltip")).toHaveText(
    'Undo: Move slot "Class" (Ctrl+Z)',
  );
  await undo.click();

  await expect.poll(() => outlineOrder(page)).toContain("slot:options.class");
  const order = await outlineOrder(page);
  expect(order.indexOf("slot:options.class")).toBeLessThan(
    order.indexOf("slot:options.paragon"),
  );
  // The whole drop was that one step, so there is nothing left to undo in this layer.
  await expect(undo).toBeDisabled();
});

test("dropping a slot on another section's header moves it into that section", async ({
  page,
}) => {
  await openBuilder(page);
  await openSlotsFor(page);
  await page.locator(".editor-search").fill("bolster");

  await dragOnto(
    handleOf(outlineRow(page, "slot", COMPANION_BOLSTER)),
    outlineRow(page, "section", "mounts"),
    "into",
  );

  // Membership is what moved: the outline now lists the slot under Mounts, after the one
  // Mounts already had, and the Companions group has nothing left that matches.
  await expect
    .poll(() => outlineOrder(page))
    .toEqual([
      "section:mounts",
      `slot:${MOUNT_BOLSTER}`,
      `slot:${COMPANION_BOLSTER}`,
    ]);

  await backToBuild(page);
  await expect
    .poll(() => sectionSlotOrder(page, "mounts"))
    .toContain(`slot:${COMPANION_BOLSTER}`);
  expect(await sectionSlotOrder(page, "companions")).not.toContain(
    `slot:${COMPANION_BOLSTER}`,
  );
});

test("dropping a slot above another section's slot lands it at that position", async ({
  page,
}) => {
  await openBuilder(page);
  await openSlotsFor(page);
  await page.locator(".editor-search").fill("bolster");

  await dragOnto(
    handleOf(outlineRow(page, "slot", COMPANION_BOLSTER)),
    outlineRow(page, "slot", MOUNT_BOLSTER),
    "before",
  );

  await expect
    .poll(() => outlineOrder(page))
    .toEqual([
      "section:mounts",
      `slot:${COMPANION_BOLSTER}`,
      `slot:${MOUNT_BOLSTER}`,
    ]);

  await backToBuild(page);
  const rendered = await sectionSlotOrder(page, "mounts");
  expect(rendered.indexOf(`slot:${COMPANION_BOLSTER}`)).toBeLessThan(
    rendered.indexOf(`slot:${MOUNT_BOLSTER}`),
  );
});

test("dragging a section header reorders the sections", async ({ page }) => {
  await openBuilder(page);
  await openSlotsFor(page);
  await page.locator(".editor-search").fill("bolster");

  await dragOnto(
    handleOf(outlineRow(page, "section", "mounts")),
    outlineRow(page, "section", "companions"),
    "before",
  );

  await expect
    .poll(() => outlineOrder(page))
    .toEqual([
      "section:mounts",
      `slot:${MOUNT_BOLSTER}`,
      "section:companions",
      `slot:${COMPANION_BOLSTER}`,
    ]);

  await backToBuild(page);
  const sections = await page
    .locator("[data-section-id]")
    .evaluateAll((nodes) =>
      nodes.map((node) => node.getAttribute("data-section-id")),
    );
  // Mounts shipped right after Companions; the drop put it directly above instead.
  expect(sections.indexOf("companions") - sections.indexOf("mounts")).toBe(1);
});
