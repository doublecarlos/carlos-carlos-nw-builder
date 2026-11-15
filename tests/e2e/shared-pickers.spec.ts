// A shared picker is one pick several bonuses read, like the location. Its control shows on
// every equipped reader's row and on its own row in the Shared inputs section, all writing the
// one pick. The own row stays while it holds a pick, since a pick is always equipped.
import { test, expect, type Locator, type Page } from "@playwright/test";
import {
  chooseCombo,
  chooseItem,
  ensureSectionExpanded,
  headerRow,
  openBuilder,
  pickerInput,
  slotRow,
} from "./support/app";
import { importTestCatalog } from "./support/testCatalog";

const GLOBALS = "test-shared";
const PLACE = `${GLOBALS}.place`;

async function openWithReaders(page: Page, choices: Record<string, string>) {
  await openBuilder(page);
  await importTestCatalog(page, {
    items: [
      {
        id: "test-port",
        name: "Test Port",
        filter: "test_place",
        tags: ["test-region:coast"],
      },
      { id: "test-dunes", name: "Test Dunes", filter: "test_place" },
      {
        id: "test-shell",
        name: "Test Shell Ring",
        filter: "gear_ring",
        bonuses: ["test-coast"],
      },
      {
        id: "test-map",
        name: "Test Map Ring",
        filter: "gear_ring",
        bonuses: ["test-chart"],
      },
      { id: "test-plain", name: "Test Plain Ring", filter: "gear_ring" },
    ],
    bonuses: [
      {
        id: "test-coast",
        name: "Test Coast",
        grants: [
          {
            when: { equipped: { tag: "test-region:coast" } },
            stats: { power: 5 },
          },
        ],
      },
      {
        id: "test-chart",
        name: "Test Chart",
        grants: [
          { when: { equipped: { item: "test-port" } }, stats: { power: 5 } },
        ],
      },
    ],
    slots: [
      {
        id: PLACE,
        label: "Test Place",
        section: GLOBALS,
        type: "item_picker",
        filter: "test_place",
        globalInput: true,
      },
    ],
    sections: [{ id: GLOBALS, label: "Test Shared", slotIds: [PLACE] }],
    choices,
  });
  await ensureSectionExpanded(page, "gear");
}

const shared = (row: Locator) =>
  row.getByTestId(`shared-picker-${PLACE}`).getByTestId("picker-input");

test("one pick shows on both reader rows and its own row, all in sync", async ({
  page,
}) => {
  await openWithReaders(page, {
    "gear.ring1": "test-shell",
    "gear.ring2": "test-map",
  });
  await ensureSectionExpanded(page, GLOBALS);
  const ring1 = slotRow(page, "gear.ring1");
  const ring2 = slotRow(page, "gear.ring2");
  const own = pickerInput(slotRow(page, PLACE));

  await chooseCombo(ring1.getByTestId(`shared-picker-${PLACE}`), "Test Port");
  await expect(own).toHaveValue("Test Port");
  await expect(shared(ring2)).toHaveValue("Test Port");
  await expect(
    ring1.getByTestId(`shared-picker-${PLACE}-shared`),
  ).toHaveAttribute("aria-label", "Shared input, also on Ring 2");
  await expect(page.getByTestId(`slot-used-by:${PLACE}`)).toHaveText(
    "Used by Ring 1, Ring 2",
  );

  await chooseItem(page, PLACE, "Test Dunes");
  await expect(shared(ring1)).toHaveValue("Test Dunes");
  await expect(shared(ring2)).toHaveValue("Test Dunes");
});

test("the own row shows while a reader is equipped or it holds a pick", async ({
  page,
}) => {
  await openWithReaders(page, { "gear.ring1": "test-plain" });
  // No reader and no pick: nothing to set.
  await expect(headerRow(page, GLOBALS)).toBeHidden();

  await chooseItem(page, "gear.ring1", "Test Shell Ring");
  await ensureSectionExpanded(page, GLOBALS);
  await expect(slotRow(page, PLACE)).toBeVisible();
  await chooseItem(page, PLACE, "Test Port");

  // The pick is still equipped, so its row stays after the last reader leaves.
  await chooseItem(page, "gear.ring1", "Test Plain Ring");
  await expect(
    slotRow(page, "gear.ring1").getByTestId(`shared-picker-${PLACE}`),
  ).toHaveCount(0);
  await expect(slotRow(page, PLACE)).toBeVisible();
  await expect(page.getByTestId(`slot-used-by:${PLACE}`)).toHaveCount(0);
});
