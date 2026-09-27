// The typed values one build-editor row shows: the engine's input table (engine/inputs.ts)
// narrowed to the row, with where each control renders, its test id and its control. What a
// kind shows on its own is its `VIEWS` entry; a value with a range error or a compare diff is
// shown regardless, so the player can see and fix it.
import { computed, toValue, type MaybeRefOrGetter } from "vue";
import { inputs, resolved } from "../stores/resolved";
import { inputKey } from "../lib/build-inputs";
import type { InputEntry, InputKindId } from "../engine/inputs";
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
  control: "checkbox" | "stepper" | "field";
}

interface InputView {
  /** Whether the row shows the entry when nothing pins it. */
  visible(entry: InputEntry, bonuses: Map<string, EvaluatedBonus>): boolean;
  itemId(entry: InputEntry): string | undefined;
  testid(entry: InputEntry, slot: Slot): string;
  control(entry: InputEntry): BuildInput["control"];
}

const addressItem = (address: InputAddress) =>
  address.store === "occurrenceInputs" || address.store === "assignments"
    ? address.itemId
    : undefined;

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
  /** A fixed count (`min === max`) takes no input. */
  occurrence: {
    visible: (entry) => entry.spec.min !== entry.spec.max,
    itemId: (entry) => addressItem(entry.address),
    testid: (entry, slot) => {
      if (entry.address.store !== "occurrenceInputs") return "";
      const { itemId, bonusId } = entry.address;
      const prefix =
        slot.type === "point_assignment"
          ? `assignment-occurrence-${itemId}`
          : "occurrence";
      const part = entry.spec.type === "boolean" ? "toggle" : "input";
      return `${prefix}-${part}-${bonusId}`;
    },
    control: (entry) =>
      entry.spec.type === "boolean" ? "checkbox" : "stepper",
  },
  repetition: {
    visible: () => true,
    itemId: (entry) => addressItem(entry.address),
    testid: (entry, slot) =>
      `${slot.type === "point_assignment" ? "assignment" : "repetition"}-input-${addressItem(entry.address)}`,
    control: () => "stepper",
  },
};

/** `slot`'s typed values. `pinned` names addresses shown whatever their view says, such as
 *  the row's compare diffs. */
export function useSlotInputs(
  slot: MaybeRefOrGetter<Slot>,
  pinned: MaybeRefOrGetter<readonly InputAddress[]> = [],
) {
  return computed<BuildInput[]>(() => {
    const row = toValue(slot);
    const own = inputs.value.filter((entry) => entry.slotId === row.id);
    if (!own.length) return [];

    const result = resolved.value.ok ? resolved.value.result : null;
    const bonuses = new Map(
      (result?.bonuses ?? [])
        .filter((bonus) => bonus.slotId === row.id)
        .map((bonus) => [bonus.bonusId, bonus]),
    );
    const forced = new Set(
      [
        ...toValue(pinned),
        ...(result?.errors ?? []).flatMap((error) =>
          error.slotId === row.id && error.address ? [error.address] : [],
        ),
      ].map(inputKey),
    );

    return own.flatMap((entry) => {
      const view = VIEWS[entry.kind];
      if (!view.visible(entry, bonuses) && !forced.has(inputKey(entry.address)))
        return [];
      return [
        {
          ...entry,
          anchor: { slotId: row.id, itemId: view.itemId(entry) },
          testid: view.testid(entry, row),
          control: view.control(entry),
        },
      ];
    });
  });
}
