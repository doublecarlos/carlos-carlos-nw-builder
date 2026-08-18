// End-to-end coverage for issue #271: build_parameter slots are authorable in a layer, and a
// layer-defined parameter is a real parameter everywhere else -- it renders in the build
// editor, resolves at its default with no seeding step, and can be reverted or removed again.
import { test, expect, type Page } from "@playwright/test";
import { openBuilder, slotRow } from "./support/app";
import { addLayer, layerRow } from "./support/nav";

/** Creates a layer, selects it, and opens the Parameters tab. */
async function openParametersTab(page: Page) {
  await addLayer(page);
  await layerRow(page, "Layer 1").locator(".nav-name").click();
  await page.getByTestId("tab-slots").click();
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

async function fillNewParam(
  page: Page,
  { label, path, fallback }: { label: string; path: string; fallback: string },
) {
  await page.getByTestId("new-slot").click();
  await page.getByTestId("slot-label-input").fill(label);
  await page.getByTestId("slot-path-input").fill(path);
  await page.getByTestId("slot-default-input").fill(fallback);
}

test("a parameter created in a layer shows up in the build editor", async ({
  page,
}) => {
  await openBuilder(page);
  await openParametersTab(page);

  await fillNewParam(page, {
    label: "Bolster",
    path: "bolster",
    fallback: "42",
  });
  // The section combobox has no default -- a parameter has to say where it renders.
  await page
    .getByTestId("slot-section-input")
    .getByTestId("picker-input")
    .click();
  await page
    .getByTestId("slot-section-input")
    .getByText("Options", { exact: true })
    .click();
  await page.getByTestId("save-slot").click();

  await backToBuild(page);

  const row = slotRow(page, "options.bolster");
  await expect(row).toBeVisible();
  await expect(row).toContainText("Bolster");
  // Shown at the slot's own default, even though `defaultBuild` never seeded `context` for
  // it -- the control has to agree with what the engine is already resolving.
  await expect(row.locator("input")).toHaveValue("42");
});

test("a parameter whose path duplicates a shipped one is rejected", async ({
  page,
}) => {
  await openBuilder(page);
  await openParametersTab(page);

  await fillNewParam(page, {
    label: "My Duration",
    // `options.duration` already owns this path -- the two would silently share one value.
    path: "duration",
    fallback: "10",
  });
  await page
    .getByTestId("slot-section-input")
    .getByTestId("picker-input")
    .click();
  await page
    .getByTestId("slot-section-input")
    .getByText("Options", { exact: true })
    .click();

  await expect(page.getByTestId("slot-path-clash")).toContainText(
    "options.duration",
  );
  await page.getByTestId("save-slot").click();
  await expect(page.getByTestId("slot-error")).toContainText(
    "already used by options.duration",
  );
});

test("editing a shipped parameter and reverting brings the shipped one back", async ({
  page,
}) => {
  await openBuilder(page);
  await openParametersTab(page);

  await page.locator(".editor-search").fill("Magnitude");
  await page.locator(".editor-row", { hasText: "Magnitude" }).first().click();
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

test("editing a shipped parameter's label keeps its visibleWhen scoping", async ({
  page,
}) => {
  await openBuilder(page);
  await openParametersTab(page);

  // options.forte1 ships scoped to "a paragon is equipped" (issue #270). The form has no
  // visibleWhen editor, so this is really a test that it carries unedited fields through
  // rather than dropping them on save.
  await page.locator(".editor-search").fill("Forte 1");
  await page.locator(".editor-row", { hasText: "Forte 1" }).first().click();
  await page.getByTestId("slot-label-input").fill("Primary Forte");

  await backToBuild(page);
  // Still hidden: no paragon is equipped, so the rename must not have un-scoped it.
  await expect(slotRow(page, "options.forte1")).toHaveCount(0);
});

test("a layer-defined parameter travels with a downloaded build", async ({
  page,
}) => {
  await openBuilder(page);
  await openParametersTab(page);

  await fillNewParam(page, {
    label: "Bolster",
    path: "bolster",
    fallback: "42",
  });
  await page
    .getByTestId("slot-section-input")
    .getByTestId("picker-input")
    .click();
  await page
    .getByTestId("slot-section-input")
    .getByText("Options", { exact: true })
    .click();
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
