// The quick-compare picker's per-slot diffing: whether a slot's choice, typed value, or a
// bonus it takes part in differs from the compare build.
import { computed, type Ref } from 'vue';
import type { Build, Db, EvaluatedBonus, Item, ResolvedBuild, StatValues } from '../types';

export interface SlotDiff {
  choice: boolean;
  value: boolean;
  bonuses: { id: string; message: string }[];
}

export function useCompareDiff(options: {
  db: Ref<Db>;
  build: Ref<Build>;
  result: Ref<ResolvedBuild>;
  compareBuild: Ref<Build | null>;
  compareResult: Ref<ResolvedBuild | null>;
  itemIn: (slotId: string) => Item | null;
}) {
  const { db, build, result, compareBuild, compareResult, itemIn } = options;

  function otherChoice(slotId: string) {
    return compareBuild.value?.choices?.[slotId] || '';
  }

  function differs(slotId: string) {
    return Boolean(compareBuild.value)
      && (build.value.choices[slotId] || '') !== otherChoice(slotId);
  }

  /** True if this slot's typed dynamic-modification magnitude differs from the compare
   * build's -- only meaningful when the same item occupies the slot in both (a differing
   * item already gets its own note via `differs` above, and the two magnitudes would not be
   * comparable if the items' `dynamicStat` ranges don't even match). */
  function valueDiffers(slotId: string) {
    if (!compareBuild.value || differs(slotId)) return false;
    if (!itemIn(slotId)?.dynamicStat) return false;
    return (build.value.values[slotId] ?? null) !== (compareBuild.value.values?.[slotId] ?? null);
  }

  function statsEqual(a?: StatValues | null, b?: StatValues | null) {
    const aKeys = Object.keys(a ?? {});
    const bKeys = Object.keys(b ?? {});
    if (aKeys.length !== bKeys.length) return false;
    return aKeys.every((key) => (a as StatValues)[key] === (b ?? {})[key]);
  }

  /** Same bonus, same gate inputs on paper (same equipped item) -- but active/excluded/stacks/
   * the stats it actually contributes can still differ, since a `when` gate can read class,
   * role, toggles, duration or *other* slots' items, none of which `differs()` above looks at. */
  function bonusStatusEqual(a: EvaluatedBonus | null, b: EvaluatedBonus | null) {
    if (!a || !b) return !a && !b;
    return a.active === b.active && a.excluded === b.excluded && a.stacks === b.stacks
      && statsEqual(a.appliedStats, b.appliedStats);
  }

  /** One sentence per differing bonus, specific to *what* differs -- active/excluded/stacks/
   * amount are distinct, useful facts, not just "this is different somehow". */
  function describeBonusDiff(here: EvaluatedBonus | null, there: EvaluatedBonus | null, name: string) {
    const otherName = compareBuild.value?.name ?? 'the compare build';
    if (!here || !there) return `${name} could not be compared with “${otherName}”.`;
    if (here.active !== there.active) {
      return here.active
        ? `${name} is active here but not in “${otherName}”.`
        : `${name} is active in “${otherName}” but not here.`;
    }
    if (here.excluded !== there.excluded) {
      return here.excluded
        ? `${name} is suppressed by another bonus here, but not in “${otherName}”.`
        : `${name} is suppressed by another bonus in “${otherName}”, but not here.`;
    }
    if (here.stacks !== there.stacks) {
      return `${name} stacks ×${here.stacks} here vs ×${there.stacks} in “${otherName}”.`;
    }
    return `${name} grants a different amount in “${otherName}”.`;
  }

  /**
   * Every bonus this slot's item takes part in whose resolved outcome (active/excluded/
   * stacks/applied amount) doesn't match the compare build -- skipped entirely when the
   * slot's own choice already differs, since that note covers it and the two bonus lists
   * would otherwise not even be comparable apples-to-apples.
   */
  function bonusDiffsFor(slotId: string): { id: string; message: string }[] {
    if (!compareBuild.value || !compareResult.value || differs(slotId)) return [];
    const item = itemIn(slotId);
    if (!item) return [];
    const out: { id: string; message: string }[] = [];
    const seen = new Set<string>();
    for (const candidate of db.value.bonusesFor(item)) {
      const id = candidate.bonus.id;
      if (seen.has(id)) continue;
      seen.add(id);
      const here = result.value.bonuses.find((bonus) => bonus.id === id) ?? null;
      const there = compareResult.value.bonuses.find((bonus) => bonus.id === id) ?? null;
      if (bonusStatusEqual(here, there)) continue;
      out.push({ id, message: describeBonusDiff(here, there, candidate.bonus.name ?? id) });
    }
    return out;
  }

  /**
   * One combined pass per slot -- choice, typed value and bonus outcome -- computed once
   * rather than recomputed per template access, since `bonusDiffsFor` walks the item's own
   * bonus list per call.
   */
  const rowDiffsBySlot = computed(() => {
    const map = new Map<string, SlotDiff>();
    if (!compareBuild.value) return map;
    for (const slot of db.value.slots) {
      const choice = differs(slot.id);
      const value = !choice && valueDiffers(slot.id);
      const bonuses = choice ? [] : bonusDiffsFor(slot.id);
      if (choice || value || bonuses.length) map.set(slot.id, { choice, value, bonuses });
    }
    return map;
  });

  function rowDiff(slotId: string): SlotDiff | undefined {
    return rowDiffsBySlot.value.get(slotId);
  }

  function rowHasDiff(slotId: string) {
    return rowDiffsBySlot.value.has(slotId);
  }

  // Same field list Options.vue itself diffs against (class/role/damageType/magnitude/the 3
  // forte picks/m32Forte) -- duplicated here rather than read back off the child component,
  // same reasoning as `differs`/`rowHasDiff` computing their own counts directly off the data.
  const OPTIONS_FIELDS = ['class', 'role', 'damageType', 'magnitude', 'm32Forte'] as const;
  const FORTE_KEYS = ['primary', 'secondaryA', 'secondaryB'];

  /** How many Options fields (SlotList's own collapsible "Options" section, not the top bar's
   * QuickOptions) differ from the compare build -- feeds that section header's own diff badge. */
  const optionsDiffCount = computed(() => {
    if (!compareBuild.value) return 0;
    const mine = build.value.context;
    const theirs = compareBuild.value.context;
    let count = 0;
    for (const key of OPTIONS_FIELDS) {
      if ((mine as unknown as Record<string, unknown>)[key] !== (theirs as unknown as Record<string, unknown>)[key]) count += 1;
    }
    for (const key of FORTE_KEYS) {
      const mineForte = (mine.forte as Record<string, string | undefined>)?.[key] ?? '';
      const theirForte = (theirs.forte as Record<string, string | undefined>)?.[key] ?? '';
      if (mineForte !== theirForte) count += 1;
    }
    return count;
  });

  return { otherChoice, differs, valueDiffers, rowDiff, rowHasDiff, optionsDiffCount };
}
