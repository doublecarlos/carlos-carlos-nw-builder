// Switching builds in the nav: every editor row shows the build it now belongs to. Rows take
// their own slot's values rather than the whole build, and keep those values while they are
// unchanged, so a row that is equal in most fields must still pick up the one that differs.
import { test, expect, type Page } from "@playwright/test";
import {
  assignmentInput,
  confirmImport,
  expandAllSections,
  importText,
  openBuilder,
  pickerInput,
  slotRow,
} from "./support/app";
import { buildRow, navName } from "./support/nav";

const ELIXIR_SLOT = "buffs.elixir";
const BOON_SLOT = "boons.tier1";
const PARAM_SLOT = "options.magnitude";
const ELIXIR_A = { id: "test-switch-elixir-a", name: "Test Switch Elixir A" };
const ELIXIR_B = { id: "test-switch-elixir-b", name: "Test Switch Elixir B" };
const BOON_ID = "test-switch-boon";

const catalog = {
  items: {
    [ELIXIR_A.id]: { ...ELIXIR_A, filter: "consumable_elixir" },
    [ELIXIR_B.id]: { ...ELIXIR_B, filter: "consumable_elixir" },
    [BOON_ID]: {
      id: BOON_ID,
      name: "Test Switch Boon",
      filter: "boon_tier1",
      inlineRepetition: { min: 0, max: 5, default: 0 },
    },
  },
  bonuses: {},
  sectionPresets: {},
};

interface Values {
  elixir: { id: string; name: string };
  disabled: boolean;
  boon: number;
  magnitude: number;
}

function buildOf(id: string, name: string, values: Values) {
  return {
    id,
    name,
    choices: { [ELIXIR_SLOT]: values.elixir.id },
    assignments: { [BOON_SLOT]: { [BOON_ID]: values.boon } },
    disabledSlots: values.disabled ? { [ELIXIR_SLOT]: true } : {},
    context: { magnitude: values.magnitude },
    catalog,
  };
}

// "Same" differs from "First" only in whether the elixir counts, so switching between them
// changes one field on one row. "Other" differs from both in every field below.
const BUILDS: Record<string, Values> = {
  First: { elixir: ELIXIR_A, disabled: true, boon: 3, magnitude: 1000 },
  Same: { elixir: ELIXIR_A, disabled: false, boon: 3, magnitude: 1000 },
  Other: { elixir: ELIXIR_B, disabled: false, boon: 1, magnitude: 2000 },
};

async function openBuilds(page: Page) {
  await openBuilder(page);
  await importText(
    page,
    JSON.stringify({
      builds: Object.entries(BUILDS).map(([name, values]) =>
        buildOf(`b_switch_${name.toLowerCase()}`, `Switch ${name}`, values),
      ),
      layers: [],
    }),
  );
  await confirmImport(page);
}

async function select(page: Page, name: string) {
  const row = buildRow(page, `Switch ${name}`);
  await navName(row).click();
  await expect(navName(row)).toHaveAttribute("aria-current", "true");
  await expandAllSections(page);
}

test("each row shows the selected build's own values after a switch", async ({
  page,
}) => {
  await openBuilds(page);
  const toggle = page.getByTestId(`slot-toggle:${ELIXIR_SLOT}`);
  for (const name of ["First", "Same", "Other", "First", "Other", "Same"]) {
    const values = BUILDS[name];
    await select(page, name);
    await expect(pickerInput(slotRow(page, ELIXIR_SLOT))).toHaveValue(
      new RegExp(values.elixir.name),
    );
    await expect(toggle).toBeChecked({ checked: !values.disabled });
    await expect(
      assignmentInput(slotRow(page, BOON_SLOT), BOON_ID),
    ).toHaveValue(String(values.boon));
    await expect(
      slotRow(page, PARAM_SLOT).locator("input").first(),
    ).toHaveValue(String(values.magnitude));
  }
});
