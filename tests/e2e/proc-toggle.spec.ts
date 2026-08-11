// End-to-end coverage for per-item proc checkboxes (#82): a grant gated by `{ "proc": true }`
// shows its own checkbox on the row of whichever item first grants it, independent of the old
// build-wide toggle it replaces. Exercised via a build's own catalog overlay (storage.ts's
// `Build.catalog`) since data/db-bonuses.json ships no proc-gated grant yet -- the same
// mechanism portable-files.spec.ts uses to get custom items into a build without driving the
// layer editor UI for a single-purpose fixture.
import { test, expect, type Page } from "@playwright/test";
import { openBuilder, slotRow } from "./support/app";

const RING_SLOT = "gear.ring1";
const RING_ID = "test-proc-ring";
const SET_ID = "test-proc-ring-set";
const GRANT_KEY = `${SET_ID}:0`;

async function importText(page: Page, text: string) {
  const fileInput = page
    .getByTestId("app-header")
    .locator('input[type="file"]');
  await fileInput.setInputFiles({
    name: "import.json",
    mimeType: "application/json",
    buffer: Buffer.from(text, "utf-8"),
  });
  await expect(page.getByTestId("app-header")).toContainText(/imported/i);
}

/** A build carrying one custom ring with one proc-gated grant. */
function buildWithProcRing(procs: Record<string, boolean> = {}) {
  return {
    name: "Proc test",
    choices: { [RING_SLOT]: RING_ID },
    procs,
    catalog: {
      items: {
        [RING_ID]: {
          id: RING_ID,
          name: "Test Proc Ring",
          filter: "gear_ring",
          bonuses: [SET_ID],
        },
      },
      bonuses: {
        [SET_ID]: {
          id: SET_ID,
          name: "Test Proc Bonus",
          grants: [{ when: { proc: true }, stats: { power: 500 } }],
        },
      },
      sectionPresets: {},
    },
  };
}

test.describe("per-item proc checkbox", () => {
  test("a proc-gated grant shows a checkbox, checked by default", async ({
    page,
  }) => {
    await openBuilder(page);
    await importText(page, JSON.stringify(buildWithProcRing()));

    const row = slotRow(page, RING_SLOT);
    const checkbox = row.getByTestId(`proc-toggle-${GRANT_KEY}`);
    await expect(checkbox.locator("input")).toBeChecked();
    await expect(row).toContainText("Power");
  });

  test("unchecking it turns the grant off and its stats drop off the row", async ({
    page,
  }) => {
    await openBuilder(page);
    await importText(page, JSON.stringify(buildWithProcRing()));

    const row = slotRow(page, RING_SLOT);
    const checkbox = row.getByTestId(`proc-toggle-${GRANT_KEY}`);
    await checkbox.locator("input").uncheck();

    await expect(checkbox.locator("input")).not.toBeChecked();
    await expect(row).not.toContainText("Power");
  });

  test("re-checking it turns the grant back on", async ({ page }) => {
    await openBuilder(page);
    await importText(page, JSON.stringify(buildWithProcRing()));

    const row = slotRow(page, RING_SLOT);
    const checkbox = row.getByTestId(`proc-toggle-${GRANT_KEY}`);
    await checkbox.locator("input").uncheck();
    await checkbox.locator("input").check();

    await expect(checkbox.locator("input")).toBeChecked();
    await expect(row).toContainText("Power");
  });

  test("an explicit false in the imported build's own procs starts unchecked", async ({
    page,
  }) => {
    await openBuilder(page);
    await importText(
      page,
      JSON.stringify(buildWithProcRing({ [GRANT_KEY]: false })),
    );

    const row = slotRow(page, RING_SLOT);
    const checkbox = row.getByTestId(`proc-toggle-${GRANT_KEY}`);
    await expect(checkbox.locator("input")).not.toBeChecked();
    await expect(row).not.toContainText("Power");
  });

  test("with no custom label, the checkbox text falls back to the bonus name", async ({
    page,
  }) => {
    await openBuilder(page);
    await importText(page, JSON.stringify(buildWithProcRing()));

    const row = slotRow(page, RING_SLOT);
    await expect(row.getByTestId(`proc-toggle-${GRANT_KEY}`)).toContainText(
      "Test Proc Bonus proc",
    );
  });
});

test.describe("per-item proc checkbox: label/default overrides", () => {
  /** Same fixture as buildWithProcRing, but the grant's `proc` is the object form -- a custom
   *  checkbox label distinct from the bonus's own (in-game-accurate) name, and a proc that
   *  starts off rather than the usual default-on. */
  function buildWithCustomProc(procs: Record<string, boolean> = {}) {
    return {
      name: "Proc override test",
      choices: { [RING_SLOT]: RING_ID },
      procs,
      catalog: {
        items: {
          [RING_ID]: {
            id: RING_ID,
            name: "Test Proc Ring",
            filter: "gear_ring",
            bonuses: [SET_ID],
          },
        },
        bonuses: {
          [SET_ID]: {
            id: SET_ID,
            name: "Test Proc Bonus",
            grants: [
              {
                when: {
                  proc: { label: "10% chance to explode", default: false },
                },
                stats: { power: 500 },
              },
            ],
          },
        },
        sectionPresets: {},
      },
    };
  }

  test("a custom label replaces the bonus name on the checkbox, with no bonus name shown", async ({
    page,
  }) => {
    await openBuilder(page);
    await importText(page, JSON.stringify(buildWithCustomProc()));

    const row = slotRow(page, RING_SLOT);
    const checkbox = row.getByTestId(`proc-toggle-${GRANT_KEY}`);
    await expect(checkbox).toContainText("10% chance to explode");
    await expect(checkbox).not.toContainText("Test Proc Bonus");
  });

  test("a spec default: false starts the checkbox unchecked with no explicit build.procs entry", async ({
    page,
  }) => {
    await openBuilder(page);
    await importText(page, JSON.stringify(buildWithCustomProc()));

    const row = slotRow(page, RING_SLOT);
    const checkbox = row.getByTestId(`proc-toggle-${GRANT_KEY}`);
    await expect(checkbox.locator("input")).not.toBeChecked();
    await expect(row).not.toContainText("Power");
  });

  test("an explicit true in build.procs overrides the spec's default: false", async ({
    page,
  }) => {
    await openBuilder(page);
    await importText(
      page,
      JSON.stringify(buildWithCustomProc({ [GRANT_KEY]: true })),
    );

    const row = slotRow(page, RING_SLOT);
    const checkbox = row.getByTestId(`proc-toggle-${GRANT_KEY}`);
    await expect(checkbox.locator("input")).toBeChecked();
    await expect(row).toContainText("Power");
  });
});
