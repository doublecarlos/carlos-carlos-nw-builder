// End-to-end coverage for authoring slots in a layer through the Slots tab: every slot type,
// and how a layer-defined slot renders, resolves its default, reorders, reverts and is removed.
import { test, expect, type Page } from "@playwright/test";
import {
  openBuilder,
  chooseCombo,
  chooseItem,
  headerRow,
  pickerInput,
  slotRow,
} from "./support/app";
import { newInOutline, openSlotsTab } from "./support/layerEditor";
import { addBuild, addLayer, layerRow } from "./support/nav";

/** Creates a layer, selects it, and opens the Slots tab. */
async function openSlotsFor(page: Page) {
  await addLayer(page);
  await layerRow(page, "Layer 1").locator(".nav-name").click();
  await openSlotsTab(page);
}

/** Downloads the first build's own JSON through its nav kebab menu, same route
 * portable-files.spec.ts takes. */
async function exportedBuildJson(
  page: Page,
): Promise<{ data: { catalog: { slots: Record<string, unknown> } } }> {
  const firstBuild = page.locator(".nav-row--build").first();
  await firstBuild.locator(".nav-kebab").click();
  const downloadPromise = page.waitForEvent("download");
  await page
    .locator(".navmenu")
    .getByRole("button", { name: "Download…" })
    .click();
  const download = await downloadPromise;
  const text = await (
    await download.createReadStream()
  )
    .toArray()
    .then((chunks) => Buffer.concat(chunks).toString("utf-8"));
  return JSON.parse(text);
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

/** Opens a row in the outline by its visible name. */
async function openOutlineRow(page: Page, name: string) {
  await page.locator(".editor-search").fill(name);
  await page.locator(".editor-row", { hasText: name }).first().click();
}

/** Picks the Options section in whichever form is open. */
async function chooseOptionsSection(page: Page) {
  await chooseCombo(page.getByTestId("slot-section-input"), "Options");
}

async function fillNewParam(
  page: Page,
  { label, path, fallback }: { label: string; path: string; fallback: string },
) {
  await newInOutline(page, "new-slot");
  await page.getByTestId("slot-label-input").fill(label);
  await page.getByTestId("slot-path-input").fill(path);
  await page.getByTestId("slot-default-input").fill(fallback);
}

test("a parameter created in a layer shows up in the build editor", async ({
  page,
}) => {
  await openBuilder(page);
  await openSlotsFor(page);

  await fillNewParam(page, {
    label: "Bolster",
    path: "bolster",
    fallback: "42",
  });
  // The section combobox has no default until the outline has one open, since a slot has to
  // say where it renders.
  await chooseOptionsSection(page);
  await page.getByTestId("save-slot").click();

  await backToBuild(page);

  const row = slotRow(page, "options.bolster");
  await expect(row).toBeVisible();
  await expect(row).toContainText("Bolster");
  // Shown at the slot's own default: the build predates the slot, so nothing seeded its
  // context, and the control has to agree with what the engine is already resolving.
  await expect(row.locator("input")).toHaveValue("42");
});

test("a parameter whose path duplicates a shipped one is rejected", async ({
  page,
}) => {
  await openBuilder(page);
  await openSlotsFor(page);

  await fillNewParam(page, {
    label: "My Duration",
    // `options.duration` already owns this path -- the two would silently share one value.
    path: "duration",
    fallback: "10",
  });
  await chooseOptionsSection(page);

  await expect(page.getByTestId("slot-path-clash")).toContainText(
    "options.duration",
  );
  await page.getByTestId("save-slot").click();
  await expect(page.getByTestId("slot-error")).toContainText(
    "already used by options.duration",
  );
});

test("an item picker created in a layer offers its filter's items", async ({
  page,
}) => {
  await openBuilder(page);
  await openSlotsFor(page);

  await newInOutline(page, "new-slot");
  await page.getByTestId("slot-label-input").fill("Spare Ring");
  await chooseCombo(page.getByTestId("slot-kind-input"), "item picker");
  await chooseOptionsSection(page);
  await page.getByTestId("slot-filter-input").fill("gear_ring");
  await expect(page.getByTestId("slot-candidate-preview")).not.toContainText(
    "0 item(s)",
  );
  await page.getByTestId("save-slot").click();

  await backToBuild(page);
  const row = slotRow(page, "options.spare-ring");
  await expect(row).toBeVisible();
  await expect(row).toContainText("Spare Ring");
});

test("an item picker's default seeds a new build and comes back on clear", async ({
  page,
}) => {
  const RING = "M31 Sanguine Seal";
  const OTHER_RING = "M31 Bloodlit Veil";
  await openBuilder(page);
  await openSlotsFor(page);

  await newInOutline(page, "new-slot");
  await page.getByTestId("slot-label-input").fill("Spare Ring");
  await chooseCombo(page.getByTestId("slot-kind-input"), "item picker");
  await chooseOptionsSection(page);
  await page.getByTestId("slot-filter-input").fill("gear_ring");
  const defaultPicker = page.getByTestId("slot-item-default-input");
  await pickerInput(defaultPicker).click();
  await pickerInput(defaultPicker).fill(RING);
  await defaultPicker.getByText(RING, { exact: true }).click();
  await page.getByTestId("save-slot").click();

  // A build minted now seeds the layer's default like a shipped one. The build that was
  // there before the slot existed keeps its empty row.
  await backToBuild(page);
  await expect(pickerInput(slotRow(page, "options.spare-ring"))).toHaveValue(
    "",
  );
  await addBuild(page);
  const row = slotRow(page, "options.spare-ring");
  await expect(pickerInput(row)).toHaveValue(RING);

  // Clearing the section resets to that same default rather than to nothing.
  await chooseItem(page, "options.spare-ring", OTHER_RING);
  await expect(pickerInput(row)).toHaveValue(OTHER_RING);
  await headerRow(page, "options")
    .locator("..")
    .getByRole("button", { name: "Clear", exact: true })
    .click();
  await expect(pickerInput(row)).toHaveValue(RING);
});

test("a stable row has to select the filter its role needs", async ({
  page,
}) => {
  await openBuilder(page);
  await openSlotsFor(page);

  await newInOutline(page, "new-slot");
  await page.getByTestId("slot-label-input").fill("Bad Stable Row");
  await chooseCombo(page.getByTestId("slot-kind-input"), "item picker");
  await chooseOptionsSection(page);
  // A stable mount row must select "mount"; this one selects rings, so the save is blocked
  // before it can land a row the resolver would quietly ignore.
  await page.getByTestId("slot-filter-input").fill("gear_ring");
  await chooseCombo(page.getByTestId("slot-stable-role-input"), "mount");
  await page.getByTestId("slot-stable-group-input").fill("9");
  await page.getByTestId("save-slot").click();
  await expect(page.getByTestId("slot-error")).toContainText(
    'must select the "mount" filter',
  );
});

test("a text slot renders its text in the build editor", async ({ page }) => {
  await openBuilder(page);
  await openSlotsFor(page);

  await newInOutline(page, "new-slot");
  await chooseCombo(page.getByTestId("slot-kind-input"), "text");
  await chooseOptionsSection(page);
  await page.getByTestId("slot-text-input").fill("Read me first");
  await page.getByTestId("save-slot").click();

  await backToBuild(page);
  await expect(
    page.getByTestId("builder-content").getByText("Read me first"),
  ).toBeVisible();
});

test("a slot's kind is frozen once it is saved", async ({ page }) => {
  await openBuilder(page);
  await openSlotsFor(page);

  await openOutlineRow(page, "Magnitude");
  const kind = page.getByTestId("slot-kind-input");
  await expect(kind.getByTestId("picker-input")).toHaveValue("build parameter");
  await expect(kind.getByTestId("picker-input")).toHaveAttribute(
    "readonly",
    "",
  );
});

test("editing a shipped parameter and reverting brings the shipped one back", async ({
  page,
}) => {
  await openBuilder(page);
  await openSlotsFor(page);

  await openOutlineRow(page, "Magnitude");
  await page.getByTestId("slot-label-input").fill("Renamed Magnitude");

  await backToBuild(page);
  await expect(slotRow(page, "options.magnitude")).toContainText(
    "Renamed Magnitude",
  );

  await layerRow(page, "Layer 1").locator(".nav-name").click();
  await page.getByRole("button", { name: "Revert to shipped" }).click();

  await backToBuild(page);
  await expect(slotRow(page, "options.magnitude")).toContainText("Magnitude");
  await expect(slotRow(page, "options.magnitude")).not.toContainText("Renamed");
});

test("a slot the engine reads warns before it is deleted", async ({ page }) => {
  await openBuilder(page);
  await openSlotsFor(page);

  await openOutlineRow(page, "Magnitude");
  await expect(page.getByTestId("slot-required-warning")).toContainText(
    "the engine scales damage by it",
  );
});

test("move up reorders a section's slots in the build editor", async ({
  page,
}) => {
  await openBuilder(page);
  await openSlotsFor(page);

  await openOutlineRow(page, "Role");
  await page.getByTestId("outline-move-up").click();

  await backToBuild(page);
  // The Options section renders in authored order, so the move is visible as Role having
  // overtaken the slot that shipped above it.
  const order = await page
    .locator('[data-section-id="options"] [data-cursor-key^="slot:"]')
    .evaluateAll((rows) =>
      rows.map((row) => row.getAttribute("data-cursor-key")),
    );
  expect(order.indexOf("slot:options.role")).toBeLessThan(
    order.indexOf("slot:options.paragon"),
  );
});

test("duplicating a slot opens a pre-filled draft that saves as a separate slot", async ({
  page,
}) => {
  await openBuilder(page);
  await openSlotsFor(page);

  await openOutlineRow(page, "Magnitude");
  await page.getByTestId("duplicate-slot").click();
  await expect(page.getByTestId("slot-label-input")).toHaveValue("Magnitude");
  await page.getByTestId("slot-label-input").fill("Magnitude Copy");
  await page.getByTestId("slot-path-input").fill("magnitudeCopy");
  await page.getByTestId("save-slot").click();

  await backToBuild(page);
  // Both rows exist, so the copy is a new slot rather than an edit of the one it came from.
  await expect(slotRow(page, "options.magnitude")).toBeVisible();
  await expect(slotRow(page, "options.magnitude-copy")).toBeVisible();
});

test("removing a slot leaves a restorable row in the outline", async ({
  page,
}) => {
  await openBuilder(page);
  await openSlotsFor(page);

  await openOutlineRow(page, "Magnitude");
  await page.getByTestId("delete-slot").click();

  const row = page.locator(".editor-row", { hasText: "Magnitude" }).first();
  await expect(row).toContainText("removed");
  await row.getByRole("button", { name: "restore" }).click();

  await backToBuild(page);
  await expect(slotRow(page, "options.magnitude")).toBeVisible();
});

test("the arrow keys walk the outline from the search box", async ({
  page,
}) => {
  await openBuilder(page);
  await openSlotsFor(page);

  // From the search box, the first ArrowDown lands on the first row, which is the first
  // section's own heading.
  await page.locator(".editor-search").click();
  await page.keyboard.press("ArrowDown");
  await expect(page.getByTestId("form-bar-title")).toHaveText("Options");
  await page.keyboard.press("ArrowDown");
  await expect(page.getByTestId("form-bar-title")).toHaveText("Class");
});

test("a layer-defined parameter travels with a downloaded build", async ({
  page,
}) => {
  await openBuilder(page);
  await openSlotsFor(page);

  await fillNewParam(page, {
    label: "Bolster",
    path: "bolster",
    fallback: "42",
  });
  await chooseOptionsSection(page);
  await page.getByTestId("save-slot").click();

  await backToBuild(page);
  const exported = await exportedBuildJson(page);

  // Without this the parameter would be trapped in the browser that authored it, and the
  // same build would resolve differently on someone else's machine.
  expect(exported.data.catalog.slots["options.bolster"]).toMatchObject({
    id: "options.bolster",
    label: "Bolster",
    path: "bolster",
    default: 42,
  });
});
