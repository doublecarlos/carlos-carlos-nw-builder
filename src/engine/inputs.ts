// Every typed per-build value a build declares, one descriptor per mechanism. The range check
// reads this table, so a new kind of value gets its errors by adding an entry.
import {
  bonusStatAddress,
  itemStatAddress,
  readInput,
} from "../lib/build-inputs";
import {
  isPercentKind,
  kindOf,
  label as statLabel,
  outOfRangeErrorMessage,
  pctInput,
  statInput,
} from "../lib/format";
import { repetitionRows } from "../lib/inline-repetition";
import type {
  BoundedValueConfig,
  Build,
  BuildParameterSlot,
  Db,
  DynamicStatConfig,
  EngineError,
  InputAddress,
  InputSpec,
  ResolvedBonuses,
} from "../types";

export type InputKindId =
  "itemDynamic" | "bonusDynamic" | "occurrence" | "repetition";

export interface InputEntry {
  kind: InputKindId;
  address: InputAddress;
  spec: InputSpec;
  /** Current value, already resolved against `spec.default`. */
  value: number;
  /** The slot the value belongs to, for error attribution: its own slot, or the bonus's
   * anchor. */
  slotId: string;
  /** Display name of what declares the value, which its error message leads with. */
  source: string;
}

export interface InputKind {
  id: InputKindId;
  /** Every declared value this kind has on the build, active or not. */
  entries(db: Db, build: Build, resolved: ResolvedBonuses): InputEntry[];
}

/** A dynamic stat's spec: percent units for a percent/mult stat. */
export function statSpec(config: DynamicStatConfig): InputSpec {
  return {
    type: isPercentKind(kindOf(config.stat)) ? "percent" : "number",
    min: config.min,
    max: config.max,
    default: config.default,
    label: config.label ?? statLabel(config.stat),
    format: (value) => statInput(config.stat, value),
  };
}

/** A whole-number count's spec. A 0..1 range reads as on/off. */
export function countSpec(
  config: BoundedValueConfig,
  fallbackLabel: string,
): InputSpec {
  return {
    type: config.min === 0 && config.max === 1 ? "boolean" : "number",
    min: config.min,
    max: config.max,
    default: config.default,
    label: config.label ?? fallbackLabel,
    format: String,
  };
}

/** A numeric build parameter's spec. An undeclared bound is unbounded. */
export function paramSpec(slot: BuildParameterSlot): InputSpec {
  const percent = slot.paramType === "percent";
  return {
    type: percent ? "percent" : "number",
    min: slot.min ?? -Infinity,
    max: slot.max ?? Infinity,
    ...(slot.step !== undefined ? { step: slot.step } : {}),
    ...(slot.presets ? { presets: slot.presets } : {}),
    default: Number(slot.default ?? 0),
    label: slot.label,
    format: percent ? pctInput : String,
  };
}

const itemDynamic: InputKind = {
  id: "itemDynamic",
  entries: (_db, build, resolved) =>
    resolved.rows.flatMap((row) =>
      (row.item?.dynamicStats ?? []).map((config) => {
        const address = itemStatAddress(row.slotId, config.stat);
        return {
          kind: "itemDynamic" as const,
          address,
          spec: statSpec(config),
          value: readInput(build, address, config.default),
          slotId: row.slotId,
          source: row.item!.name,
        };
      }),
    ),
};

/** One entry per bonus and stat: every grant and variant of a bonus naming one stat shares
 * its stored value. */
const bonusDynamic: InputKind = {
  id: "bonusDynamic",
  entries: (_db, build, resolved) => {
    const out = new Map<string, InputEntry>();
    for (const entry of resolved.bonuses) {
      const configs = entry.grants.flatMap((grant) => [
        ...(grant.raw.dynamicStats ?? []),
        ...(grant.raw.variants ?? []).flatMap(
          (variant) => variant.dynamicStats ?? [],
        ),
      ]);
      for (const config of configs) {
        const key = `${entry.bonusId}:${config.stat}`;
        if (out.has(key)) continue;
        const address = bonusStatAddress(entry.bonusId, config.stat);
        out.set(key, {
          kind: "bonusDynamic",
          address,
          spec: statSpec(config),
          value: readInput(build, address, config.default),
          slotId: entry.slotId,
          source: entry.bonus.name ?? entry.bonusId,
        });
      }
    }
    return [...out.values()];
  },
};

const occurrence: InputKind = {
  id: "occurrence",
  entries: (db, build, resolved) =>
    resolved.rows.flatMap((row) =>
      (row.item?.bonuses ?? []).flatMap((attachment) => {
        if (typeof attachment === "string") return [];
        const address: InputAddress = {
          store: "occurrenceInputs",
          itemId: row.item!.id,
          bonusId: attachment.bonus,
        };
        const bonus = db.bonusById.get(attachment.bonus);
        return [
          {
            kind: "occurrence" as const,
            address,
            spec: countSpec(attachment, bonus?.name ?? attachment.bonus),
            value: readInput(build, address, attachment.default),
            slotId: row.slotId,
            source: row.item!.name,
          },
        ];
      }),
    ),
};

/** An `item_picker` pick's repetition count, and every row of a `point_assignment` slot. On a
 * point_assignment row 0 means "not taken", so it is always in range there. */
const repetition: InputKind = {
  id: "repetition",
  entries: (db, build, resolved) =>
    resolved.rows.flatMap((row) => {
      const slot = row.slot;
      if (slot.type !== "point_assignment" && slot.type !== "item_picker")
        return [];
      return repetitionRows(db, build, slot).map((item) => {
        const config = item.inlineRepetition!;
        const address: InputAddress = {
          store: "assignments",
          slotId: row.slotId,
          itemId: item.id,
        };
        const spec = countSpec(
          config,
          slot.type === "point_assignment" ? item.name : "Copies",
        );
        if (slot.type === "point_assignment") spec.min = Math.min(spec.min, 0);
        return {
          kind: "repetition" as const,
          address,
          spec,
          value: readInput(build, address, config.default),
          slotId: row.slotId,
          source: item.name,
        };
      });
    }),
};

export const INPUT_KINDS: InputKind[] = [
  itemDynamic,
  repetition,
  occurrence,
  bonusDynamic,
];

/** Every typed value the build declares, in `INPUT_KINDS` order. */
export function inputEntries(
  db: Db,
  build: Build,
  resolved: ResolvedBonuses,
): InputEntry[] {
  return INPUT_KINDS.flatMap((kind) => kind.entries(db, build, resolved));
}

/** An `outOfRange` error for `value`, or null when it is within `spec`'s bounds. Nothing
 * clamps a typed value, so this is what keeps one outside its range visible. */
export function rangeError(
  slotId: string,
  source: string,
  spec: InputSpec,
  value: number,
  address?: InputAddress,
): EngineError | null {
  if (!Number.isFinite(value) || (value >= spec.min && value <= spec.max))
    return null;
  const bound = (n: number) => (Number.isFinite(n) ? spec.format(n) : "");
  return {
    slotId,
    kind: "outOfRange",
    choice: source,
    message: outOfRangeErrorMessage(
      source,
      spec.format(value),
      bound(spec.min),
      bound(spec.max),
    ),
    severity: "error",
    ...(address ? { address } : {}),
  };
}

/** Every declared value outside its bounds. */
export function inputRanges(
  db: Db,
  build: Build,
  resolved: ResolvedBonuses,
): EngineError[] {
  return inputEntries(db, build, resolved).flatMap(
    (entry) =>
      rangeError(
        entry.slotId,
        entry.source,
        entry.spec,
        entry.value,
        entry.address,
      ) ?? [],
  );
}
