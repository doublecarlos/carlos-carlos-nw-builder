// The quick-compare picker's per-slot diffing: whether a slot's choice, typed value, or a
// bonus it takes part in differs from the compare build.
import { computed, type Ref } from "vue";
import { getPath } from "../lib/build-path";
import { inputKey } from "../lib/build-inputs";
import { pctInput } from "../lib/format";
import { expandSlots } from "../lib/item-picker-list";
import { isDisabled } from "../lib/slot-toggle";
import { itemLabel, stableRef } from "../engine/insignia";
import { inputEntries, type InputEntry } from "../engine/inputs";
import type {
  Build,
  BuildParameterSlot,
  Db,
  EvaluatedBonus,
  InputAddress,
  InputSpec,
  Item,
  ResolvedBuild,
  Slot,
  StatValues,
} from "../types";

export interface InputDiff {
  address: InputAddress;
  label: string;
  /** The compare build's value as its control shows it. */
  otherLabel: string;
}

/** Everything BuildSlot.vue needs to know about how one row differs from the compare build,
 *  the single prop it takes instead of a dozen separate ones. Every field applies to at most a
 *  couple of row types (noted per field); a field that doesn't apply to a given `slot.type` is
 *  always `false`/`undefined`, the same as when there is no compare build at all. */
export interface SlotDiff {
  choice: boolean;
  /** Display text for the compare build's choice, already resolved to a name; empty when it
   *  holds nothing. */
  otherChoiceLabel: string;
  /** item_picker only: the `toggleable` checkbox differs. Its own flag, not part of `choice`:
   *  both builds hold the same item, one just is not counting it. */
  disabled: boolean;
  /** Every typed value on the row that differs, matched to the compare build's by address. */
  inputs: InputDiff[];
  bonuses: { id: string; message: string }[];
  /** build_parameter only. */
  param: boolean;
  otherParamLabel?: string;
}

/** True if this slot's pick is switched off in one build and on in the other. Standalone for
 * the same reason `paramDiffers` is: it needs the two builds and nothing else. */
export function disabledDiffers(
  build: Build,
  compareBuild: Build | null,
  slot: Slot,
) {
  if (!compareBuild) return false;
  return isDisabled(build, slot) !== isDisabled(compareBuild, slot);
}

/** True if this build_parameter slot's value differs between two builds. Generic over any
 * slot's `path`. Standalone rather than part of `useCompareDiff` below: it only needs the
 * two builds, not the item/bonus machinery every other diff helper here depends on, so
 * QuickOptions.vue (which has no per-row item context at all) can use it directly. */
export function paramDiffers(
  build: Build,
  compareBuild: Build | null,
  slot: BuildParameterSlot,
) {
  if (!compareBuild) return false;
  return (
    (getPath(build.context, slot.path) ?? "") !==
    (getPath(compareBuild.context, slot.path) ?? "")
  );
}

function paramLabel(slot: BuildParameterSlot, value: unknown) {
  if (slot.paramType === "boolean") return value ? "on" : "off";
  if (slot.paramType === "list")
    return slot.options?.find((o) => o.value === value)?.label ?? "(none)";
  if (slot.paramType === "percent" && typeof value === "number")
    return pctInput(value);
  return value ?? "(none)";
}

/** The hover tooltip for a differing build_parameter slot -- the control itself just goes
 * bold/dotted/colored, this is the only place the compare build's actual value shows. */
export function paramDiffTitle(
  compareBuild: Build | null,
  slot: BuildParameterSlot,
) {
  if (!compareBuild) return undefined;
  return `${paramLabel(slot, getPath(compareBuild.context, slot.path))}`;
}

/** A typed value as its control shows it. */
function shownInput(spec: InputSpec, value: number) {
  return spec.type === "boolean" ? (value ? "on" : "off") : spec.format(value);
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

  /**
   * What a row effectively holds, which is not always what the build stored.
   *
   * Two unpinned stable bonus rows both store nothing yet differ when their mounts derive
   * different bonuses, so comparing the stored value would call them equal. Read off the
   * resolved row, where the derivation already landed.
   */
  function effectiveChoice(
    slotId: string,
    source: Build | null,
    resolved: ResolvedBuild | null,
  ) {
    const stored = source?.choices?.[slotId] || "";
    if (stored || stableRef(db.value, slotId)?.role !== "bonus") return stored;
    return resolved?.rows.find((row) => row.slotId === slotId)?.item?.id ?? "";
  }

  function otherChoice(slotId: string) {
    return effectiveChoice(slotId, compareBuild.value, compareResult.value);
  }

  function ownChoice(slotId: string) {
    return effectiveChoice(slotId, build.value, result.value);
  }

  /** Display text for the compare build's choice -- `otherChoice` above stays id-based (it
   * feeds `differs`' identity comparison), this resolves that id to the name shown in the
   * "apply" tooltip/diff note. */
  function otherChoiceLabel(slotId: string) {
    const id = otherChoice(slotId);
    if (!id) return "";
    const item = db.value.get(id);
    return item ? itemLabel(db.value, item) : id;
  }

  function differs(slotId: string) {
    return (
      Boolean(compareBuild.value) && ownChoice(slotId) !== otherChoice(slotId)
    );
  }

  /** Both builds' typed values. The compare build's are keyed by address, so a bonus's
   * settings match wherever each build renders them. */
  const ownInputs = computed(() =>
    inputEntries(db.value, build.value, result.value),
  );
  const otherInputs = computed(() => {
    const map = new Map<string, InputEntry>();
    if (!compareBuild.value || !compareResult.value) return map;
    for (const entry of inputEntries(
      db.value,
      compareBuild.value,
      compareResult.value,
    ))
      map.set(inputKey(entry.address), entry);
    return map;
  });

  /** Every typed value on this slot that differs from the compare build's. A value only one
   * build declares is left to the choice and bonus notes, as is every value on a slot whose
   * choice already differs. */
  function inputDiffs(slotId: string): InputDiff[] {
    if (!compareBuild.value || differs(slotId)) return [];
    return ownInputs.value.flatMap((entry) => {
      if (entry.slotId !== slotId) return [];
      const other = otherInputs.value.get(inputKey(entry.address));
      if (!other || other.value === entry.value) return [];
      return [
        {
          address: entry.address,
          label: entry.spec.label,
          otherLabel: shownInput(other.spec, other.value),
        },
      ];
    });
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
  function bonusStatusEqual(
    a: EvaluatedBonus | null,
    b: EvaluatedBonus | null,
  ) {
    if (!a || !b) return !a && !b;
    return (
      a.active === b.active &&
      a.excluded === b.excluded &&
      a.stacks === b.stacks &&
      statsEqual(a.appliedStats, b.appliedStats)
    );
  }

  /** One sentence per differing bonus, specific to *what* differs -- active/excluded/stacks/
   * amount are distinct, useful facts, not just "this is different somehow". */
  function describeBonusDiff(
    here: EvaluatedBonus | null,
    there: EvaluatedBonus | null,
    name: string,
  ) {
    const otherName = compareBuild.value?.name ?? "the compare build";
    // Both absent never reaches here: `bonusStatusEqual` calls that equal and skips the row.
    if (!there) return `${name} is not in “${otherName}” at all.`;
    if (!here) return `${name} is only in “${otherName}”.`;
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
    if (!compareBuild.value || !compareResult.value || differs(slotId))
      return [];
    const item = itemIn(slotId);
    if (!item) return [];
    const out: { id: string; message: string }[] = [];
    const seen = new Set<string>();
    for (const candidate of db.value.bonusesFor(item)) {
      const id = candidate.bonus.id;
      if (seen.has(id)) continue;
      seen.add(id);
      const here =
        result.value.bonuses.find((bonus) => bonus.id === id) ?? null;
      const there =
        compareResult.value.bonuses.find((bonus) => bonus.id === id) ?? null;
      if (bonusStatusEqual(here, there)) continue;
      out.push({
        id,
        message: describeBonusDiff(here, there, candidate.bonus.name ?? id),
      });
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
    for (const slot of expandSlots(db.value.slots, build.value)) {
      const choice = differs(slot.id);
      const disabled = disabledDiffers(build.value, compareBuild.value, slot);
      const inputs = inputDiffs(slot.id);
      const bonuses = choice ? [] : bonusDiffsFor(slot.id);
      const param =
        slot.type === "build_parameter" &&
        paramDiffers(build.value, compareBuild.value, slot);
      if (choice || disabled || inputs.length || bonuses.length || param) {
        map.set(slot.id, {
          choice,
          otherChoiceLabel: otherChoiceLabel(slot.id),
          disabled,
          inputs,
          bonuses,
          param,
          otherParamLabel:
            param && slot.type === "build_parameter"
              ? paramDiffTitle(compareBuild.value, slot)
              : undefined,
        });
      }
    }
    return map;
  });

  function rowDiff(slotId: string): SlotDiff | undefined {
    return rowDiffsBySlot.value.get(slotId);
  }

  function rowHasDiff(slotId: string) {
    return rowDiffsBySlot.value.has(slotId);
  }

  /** How many of the "options" section's own build_parameter slots (not `quick`, so not the
   * top bar's QuickOptions strip) differ from the compare build -- feeds that section header's
   * diff badge. */
  const optionsDiffCount = computed(() => {
    if (!compareBuild.value) return 0;
    return db.value.slots.filter(
      (slot): slot is BuildParameterSlot =>
        slot.type === "build_parameter" &&
        slot.section === "options" &&
        !slot.quick &&
        paramDiffers(build.value, compareBuild.value, slot),
    ).length;
  });

  return {
    otherChoice,
    otherChoiceLabel,
    differs,
    inputDiffs,
    rowDiff,
    rowHasDiff,
    optionsDiffCount,
  };
}
