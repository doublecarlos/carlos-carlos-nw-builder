// The typed values one build-editor row shows: the engine's input table (engine/inputs.ts)
// narrowed to the row, with where each control renders, its test id and its control. What a
// kind shows on its own is its `VIEWS` entry; a value with a range error or a compare diff is
// shown regardless, so the player can see and fix it. A bonus input renders on its anchor's
// row only; the rows of its other copies get a note pointing there. A global input renders on
// every reader's row, each control writing the one shared value.
import { computed, toValue, type MaybeRefOrGetter } from "vue";
import {
  globalReaders,
  inputCopies,
  inputsBySlot,
  resolvedIndex,
} from "../stores/resolved";
import { inputKey } from "../lib/build-inputs";
import { sharedNote } from "../lib/resolved-index";
import { keepEqual } from "../lib/keep-identity";
import { isCarried } from "../lib/bonus-inspector";
import {
  numberControl,
  type InputEntry,
  type InputKindId,
} from "../engine/inputs";
import type {
  DynamicStatConfig,
  EvaluatedBonus,
  InputAddress,
  Slot,
} from "../types";

export interface BuildInput extends InputEntry {
  /** Where the control renders: its slot, plus the item for a value tied to one of a
   *  point_assignment row's items. */
  anchor: { slotId: string; itemId?: string };
  testid: string;
  /** `note` stands in for a control rendered on another row, naming where it is. */
  control: "checkbox" | "stepper" | "field" | "note";
  note?: string;
  /** A global input's other readers on the build, under its control. */
  shared?: string;
}

interface InputView {
  /** Whether the row shows the entry when nothing pins it. */
  visible(
    entry: InputEntry,
    bonuses: ReadonlyMap<string, EvaluatedBonus>,
  ): boolean;
  itemId(entry: InputEntry): string | undefined;
  testid(entry: InputEntry, slot: Slot): string;
  control(entry: InputEntry): BuildInput["control"];
}

const addressItem = (address: InputAddress) =>
  address.store === "assignments" ? address.itemId : undefined;

/** The dynamic stats a grant applies right now: its chosen variant's, or its own. */
function activeStatConfigs(
  grant: EvaluatedBonus["grants"][number],
): DynamicStatConfig[] {
  if (!grant.active) return [];
  if (!grant.chose?.startsWith("variant:")) return grant.raw.dynamicStats ?? [];
  const index = Number(grant.chose.slice("variant:".length));
  return grant.raw.variants?.[index]?.dynamicStats ?? [];
}

const statView: Omit<InputView, "visible"> = {
  itemId: () => undefined,
  testid: (entry) =>
    "key" in entry.address ? `slot-dynamic:${entry.address.key}` : "",
  control: () => "field",
};

const VIEWS: Record<InputKindId, InputView> = {
  itemDynamic: { ...statView, visible: () => true },
  /** Shown while a grant applying the stat is active. */
  bonusDynamic: {
    ...statView,
    visible: (entry, bonuses) => {
      if (entry.address.store !== "bonusValues") return false;
      const { bonusId, key } = entry.address;
      return (
        bonuses
          .get(bonusId)
          ?.grants.some((grant) =>
            activeStatConfigs(grant).some((config) => config.stat === key),
          ) ?? false
      );
    },
  },
  /** Shown while an item on the build carries the bonus, active or not, so an input gating
   *  the bonus can still switch it on. */
  bonusInput: {
    visible: (entry, bonuses) => {
      const bonus = entry.bonusInput && bonuses.get(entry.bonusInput.bonusId);
      return bonus ? isCarried(bonus) : false;
    },
    itemId: (entry) => entry.itemId,
    testid: (entry) =>
      entry.bonusInput
        ? `bonus-input-${entry.bonusInput.bonusId}-${entry.bonusInput.name}`
        : "",
    control: (entry) =>
      entry.spec.type === "boolean" ? "checkbox" : numberControl(entry.spec),
  },
  repetition: {
    visible: () => true,
    itemId: (entry) => addressItem(entry.address),
    testid: (entry, slot) =>
      `${slot.type === "point_assignment" ? "assignment" : "repetition"}-input-${addressItem(entry.address)}`,
    control: () => "stepper",
  },
};

const NO_BONUSES: ReadonlyMap<string, EvaluatedBonus> = new Map();

/** `slot`'s typed values. `pinned` names addresses shown whatever their view says, such as
 *  the row's compare diffs. The list keeps its previous identity while its entries are
 *  unchanged, so a new resolve with the same values re-renders nothing. */
export function useSlotInputs(
  slot: MaybeRefOrGetter<Slot>,
  pinned: MaybeRefOrGetter<readonly InputAddress[]> = [],
) {
  return computed<BuildInput[]>((previous) =>
    keepEqual(previous, slotInputs(toValue(slot), toValue(pinned))),
  );
}

function slotInputs(row: Slot, pinned: readonly InputAddress[]): BuildInput[] {
  const own = inputsBySlot.value.get(row.id) ?? [];
  const notes = copyNotes(row);
  if (!own.length) return notes;

  const index = resolvedIndex.value;
  const bonuses = index.slotBonuses.get(row.id) ?? NO_BONUSES;
  const forced = new Set(
    [
      ...pinned,
      ...(index.errors.get(row.id) ?? []).flatMap((error) =>
        error.address ? [error.address] : [],
      ),
    ].map(inputKey),
  );

  const readers = globalReaders.value;
  // Two bonuses on one row reading the same global input share one control there.
  const shown = new Set<string>();
  const controls = own.flatMap((entry) => {
    const view = VIEWS[entry.kind];
    const key = inputKey(entry.address);
    if (!view.visible(entry, bonuses) && !forced.has(key)) return [];
    if (shown.has(key)) return [];
    shown.add(key);
    const shared = sharedNote(entry, readers);
    return [
      {
        ...entry,
        anchor: { slotId: row.id, itemId: view.itemId(entry) },
        testid: view.testid(entry, row),
        control: view.control(entry),
        ...(shared && { shared }),
      },
    ];
  });
  return [...controls, ...notes];
}

/** A note for each bonus input whose bonus also comes from `row` but renders elsewhere. */
function copyNotes(row: Slot): BuildInput[] {
  const copies = inputCopies.value.get(row.id);
  if (!copies) return [];
  const { rows } = resolvedIndex.value;
  return copies.flatMap(({ entry, itemId }) => {
    if (!entry.bonusInput) return [];
    const { bonusId, name } = entry.bonusInput;
    const anchor = rows.get(entry.slotId);
    return [
      {
        ...entry,
        anchor: { slotId: row.id, itemId },
        testid: `bonus-input-note-${bonusId}-${name}`,
        control: "note" as const,
        note: `${entry.spec.label}: set on ${anchor?.slot.label ?? entry.slotId}`,
      },
    ];
  });
}
