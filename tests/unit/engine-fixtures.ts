// Builders for small synthetic catalogs. Engine tests author their own items, bonuses and
// slots here rather than reading the shipped data, so a test only fails when a rule changes.
import * as db from "../../src/data/db";
import * as engine from "../../src/engine/engine";
import { storedListRows } from "../../src/lib/item-picker-list";
import type {
  Bonus,
  Build,
  BuildContext,
  Db,
  EvaluatedBonus,
  FilterDef,
  Item,
  ItemPickerSlot,
  Schema,
  Slot,
} from "../../src/types";

/** A schema carrying only `statKeys`, every one a plain flat stat. */
export function testSchema(statKeys: string[]): Schema {
  const stats = statKeys.map((key) => ({
    key,
    label: key,
    kind: "flat" as const,
  }));
  return {
    stats,
    statByKey: Object.fromEntries(stats.map((stat) => [stat.key, stat])),
    statKeys,
    multiplicativeStats: [],
    ratingStats: [],
    abilityStats: [],
    ratingConversion: [],
    statContributions: [],
    forteSplit: {},
    roles: {
      dps: { label: "dps", hpBonus: 1, damageBonus: 1 },
      healer: { label: "healer", hpBonus: 1, damageBonus: 1 },
      tank: { label: "tank", hpBonus: 1, damageBonus: 1 },
    },
  };
}

/** An item_picker slot, its section taken from the id's prefix. */
export const picker = (id: string, filter: string): ItemPickerSlot => ({
  id,
  label: id,
  section: id.split(".")[0],
  type: "item_picker",
  filter,
});

/** A db over exactly these entries, one section per distinct `slot.section`. */
export function testDb(
  schema: Schema,
  items: Item[],
  bonuses: Bonus[],
  slots: Slot[],
  filters: FilterDef[] = [],
): Db {
  const sections = [...new Set(slots.map((slot) => slot.section))].map(
    (id) => ({ id, label: id, slotIds: [] }),
  );
  return db.build(items, bonuses, schema, { sections, slots }, filters);
}

/** A context with nothing switched on beyond what a test passes. */
export const TEST_CONTEXT: BuildContext = {
  class: "",
  role: "dps",
  damageType: "",
  duration: 60,
  enemies: 1,
  magnitude: 100,
  m32Forte: false,
  mountBolster: 0,
  companionBolster: 0,
  forte: {},
  toggles: {},
};

export interface TestBuildParts {
  choices?: Build["choices"];
  values?: Build["values"];
  assignments?: Build["assignments"];
  bonusValues?: Build["bonusValues"];
  /** `scalers` holds scaler-parameter values, which live in the context off its typed fields. */
  context?: Partial<BuildContext> & { scalers?: Record<string, unknown> };
}

/** A build holding only what the test slots in. */
export function testBuild(
  parts: TestBuildParts = {},
  baseContext: BuildContext = TEST_CONTEXT,
): Build {
  const choices = parts.choices ?? {};
  const values = parts.values ?? {};
  const assignments = parts.assignments ?? {};
  return {
    id: "b",
    name: "b",
    choices,
    values,
    assignments,
    bonusValues: parts.bonusValues ?? {},
    listRows: storedListRows({
      choices,
      values,
      assignments,
      disabledSlots: {},
    }),
    disabledSlots: {},
    context: {
      ...baseContext,
      ...parts.context,
      toggles: { ...baseContext.toggles, ...parts.context?.toggles },
    },
    compare: { id: "", highlight: false, onlyDiff: false, statLines: false },
  };
}

export type Resolved = ReturnType<typeof engine.resolveBuild>;

/** The resolved bonus with this id, active or not. */
export const bonusOf = (result: Resolved, id: string) =>
  result.bonuses.find((entry: EvaluatedBonus) => entry.id === id);

/** Whether the bonus resolved active. */
export const isActive = (result: Resolved, id: string) =>
  bonusOf(result, id)?.active === true;

/** One active bonus's per-stack payload for `stat`, undefined while inactive. */
export const statOf = (result: Resolved, id: string, stat: string) => {
  const entry = bonusOf(result, id);
  return entry?.active ? entry.stats?.[stat] : undefined;
};

/** One active bonus's applied value for `stat`: the payload times its stacks. */
export const appliedStatOf = (result: Resolved, id: string, stat: string) => {
  const entry = bonusOf(result, id);
  return entry?.active ? entry.appliedStats?.[stat] : undefined;
};

/** The resolved row for a slot. */
export const rowOf = (result: Resolved, slotId: string) => {
  const row = result.rows.find((entry) => entry.slotId === slotId);
  if (!row) throw new Error(`no row for slot "${slotId}"`);
  return row;
};
