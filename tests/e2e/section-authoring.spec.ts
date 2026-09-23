// End-to-end coverage for authoring a layout section in a layer: creating it, its default open
// state in the build editor, reordering, reaching it from lint, and deleting it with or
// without its slots.
import { test, expect, type Locator, type Page } from "@playwright/test";
import {
  openBuilder,
  chooseCombo,
  ensureSectionExpanded,
  headerRow,
} from "./support/app";
import { newInOutline, openSlotsTab } from "./support/layerEditor";
import { addLayer, layerRow, toggleLayerCheckbox } from "./support/nav";

const SECTION = "Field Notes";

async function openSlotsFor(page: Page) {
  await addLayer(page);
  await layerRow(page, "Layer 1").locator(".nav-name").click();
  await openSlotsTab(page);
}

async function backToBuild(page: Page) {
  await page
    .getByTestId("library")
    .locator(".nav-row--build")
    .first()
    .locator(".nav-name")
    .click();
  await expect(page.getByTestId("builder-content")).toBeVisible();
}

/** Creates the section and leaves it selected in the outline. A new section starts open in
 *  the build editor unless `collapsed` unticks that. */
async function createSection(
  page: Page,
  label = SECTION,
  { collapsed = false } = {},
) {
  await newInOutline(page, "new-section");
  await page.getByTestId("section-label-input").fill(label);
  if (collapsed) await page.getByTestId("section-default-open-input").uncheck();
  await page.getByTestId("save-section").click();
  await expect(page.getByText(`Saved section "${label}"`)).toBeVisible();
}

/** The build editor's expand/collapse arrow on a section header. */
const arrowOf = (header: Locator) => header.locator("span:first-child");

/** Adds one text slot to whatever section the outline has open. */
async function addTextSlot(page: Page, text: string) {
  await newInOutline(page, "new-slot");
  await chooseCombo(page.getByTestId("slot-kind-input"), "text");
  await page.getByTestId("slot-text-input").fill(text);
  await page.getByTestId("save-slot").click();
}

test("a section created in a layer renders in the build editor", async ({
  page,
}) => {
  await openBuilder(page);
  await openSlotsFor(page);
  await createSection(page);
  await addTextSlot(page, "Remember the boons");

  await backToBuild(page);
  await expect(headerRow(page, "field-notes")).toContainText(SECTION);
  await ensureSectionExpanded(page, "field-notes");
  await expect(
    page.getByTestId("builder-content").getByText("Remember the boons"),
  ).toBeVisible();
});

test("a section starts open or collapsed as authored, whatever UI state was saved before it existed", async ({
  page,
}) => {
  await openBuilder(page);
  // Save an open state that has no entry for the sections the layer will add.
  await headerRow(page, "gear").click();
  await headerRow(page, "gear").click();

  await openSlotsFor(page);
  await createSection(page);
  await addTextSlot(page, "Remember the boons");
  await createSection(page, "Scratch", { collapsed: true });
  await addTextSlot(page, "Scratch notes");

  await backToBuild(page);
  await expect(arrowOf(headerRow(page, "field-notes"))).toHaveText("▾");
  await expect(arrowOf(headerRow(page, "scratch"))).toHaveText("▸");

  // Toggling the layer off and on brings the sections back with the same defaults.
  await toggleLayerCheckbox(layerRow(page, "Layer 1"));
  await expect(headerRow(page, "field-notes")).toHaveCount(0);
  await toggleLayerCheckbox(layerRow(page, "Layer 1"));
  await expect(arrowOf(headerRow(page, "field-notes"))).toHaveText("▾");
  await expect(arrowOf(headerRow(page, "scratch"))).toHaveText("▸");
});

test("a lint finding about a section opens that section", async ({ page }) => {
  await openBuilder(page);
  await openSlotsFor(page);
  await createSection(page);

  // Empty, so the layer's lint has something to say about it.
  const finding = page
    .getByTestId("validation-drawer")
    .getByRole("button", { name: "field-notes" });
  await expect(finding).toBeVisible();

  await page.getByTestId("tab-items").click();
  await expect(page.getByTestId("new-item")).toBeVisible();

  await finding.click();
  await expect(page.getByTestId("slot-outline")).toBeVisible();
  await expect(page.getByTestId("section-label-input")).toHaveValue(SECTION);
});

test("the section form lists what the section holds, read-only", async ({
  page,
}) => {
  await openBuilder(page);
  await openSlotsFor(page);
  await createSection(page);
  await addTextSlot(page, "Remember the boons");

  await page.locator(".editor-search").fill(SECTION);
  await page.locator(".editor-row", { hasText: SECTION }).first().click();
  await expect(page.getByTestId("section-slot-list")).toContainText("text");
  await expect(page.getByTestId("section-preset-list")).toContainText(
    "No presets yet",
  );

  // The slot list's links are how the form hands over to the slot itself.
  await page
    .getByTestId("section-slot-list")
    .getByRole("button")
    .first()
    .click();
  await expect(page.getByTestId("slot-text-input")).toHaveValue(
    "Remember the boons",
  );
});

test("moving a section up puts it above the one that shipped first", async ({
  page,
}) => {
  await openBuilder(page);
  await openSlotsFor(page);
  await createSection(page);
  await addTextSlot(page, "Remember the boons");

  await page.locator(".editor-search").fill(SECTION);
  const row = page.locator(".editor-row", { hasText: SECTION }).first();
  await row.click();
  // An added section lands last, so one move puts it above the final shipped one.
  await page.getByTestId("outline-move-up").click();

  await backToBuild(page);
  const order = await page
    .locator("[data-section-id]")
    .evaluateAll((nodes) =>
      nodes.map((node) => node.getAttribute("data-section-id")),
    );
  expect(order.indexOf("field-notes")).toBeLessThan(order.length - 1);
});

test("deleting a section offers to take its slots with it", async ({
  page,
}) => {
  await openBuilder(page);
  await openSlotsFor(page);
  await createSection(page);
  await addTextSlot(page, "Remember the boons");

  await page.locator(".editor-search").fill(SECTION);
  await page.locator(".editor-row", { hasText: SECTION }).first().click();
  await page.getByTestId("delete-section").click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("Also delete its slots and presets (1)");
  await dialog.getByRole("button", { name: "Delete" }).click();
  await expect(page.getByText(`Removed section "${SECTION}"`)).toBeVisible();

  // Both are gone from the outline, so nothing is left pointing at the section.
  await page.locator(".editor-search").fill("");
  await expect(page.locator(".editor-row", { hasText: SECTION })).toHaveCount(
    0,
  );
  await expect(page.getByTestId("slot-outline")).not.toContainText(
    "Remember the boons",
  );
});

test("declining the cascade leaves the slots orphaned and lint says so", async ({
  page,
}) => {
  await openBuilder(page);
  await openSlotsFor(page);
  await createSection(page);
  await addTextSlot(page, "Remember the boons");

  await page.locator(".editor-search").fill(SECTION);
  await page.locator(".editor-row", { hasText: SECTION }).first().click();
  await page.getByTestId("delete-section").click();
  await expect(page.getByTestId("confirm-checkbox")).toContainText(
    "Also delete",
  );
  await page.getByTestId("confirm-checkbox").locator("input").uncheck();
  await page.getByTestId("confirm-accept").click();

  await page.locator(".editor-search").fill("");
  // The orphan still shows, under the bucket for rows whose section is gone, and the layer's
  // lint names it.
  await expect(page.getByTestId("slot-outline")).toContainText("No section");
  await expect(page.getByTestId("validation-drawer")).toContainText(
    "is never shown",
  );
});
