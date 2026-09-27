// Read and write access to every typed per-build value by its `InputAddress`, so each
// mechanism shares one storage path, one default fallback and one way of clearing.
import { getPath, setPath } from "./build-path";
import type { Build, InputAddress } from "../types";

type Stored = number | boolean | undefined;

/** The value stored at `address`, or undefined when nothing is. */
export function storedInput(
  build: Build,
  address: InputAddress,
): number | boolean | undefined {
  switch (address.store) {
    case "values":
      return build.values?.[address.slotId]?.[address.kind]?.[address.key];
    case "bonusValues":
      return build.bonusValues?.[address.bonusId]?.[address.kind]?.[
        address.key
      ];
    case "occurrenceInputs":
      return build.occurrenceInputs?.[address.itemId]?.[address.bonusId];
    case "assignments":
      return build.assignments?.[address.slotId]?.[address.itemId];
    case "context":
      return getPath(build.context, address.path) as Stored;
  }
}

/** The value at `address`, or `fallback` when nothing valid is stored. A boolean reads as 1
 * or 0. */
export function readInput(
  build: Build,
  address: InputAddress,
  fallback: number,
): number {
  const stored = storedInput(build, address);
  if (typeof stored === "boolean") return stored ? 1 : 0;
  return stored != null && Number.isFinite(Number(stored))
    ? Number(stored)
    : fallback;
}

/** `inner[key] = value`, or its removal for null. Returns the map, or undefined once empty. */
function withKey<T>(
  inner: Record<string, T> | undefined,
  key: string,
  value: T | null,
): Record<string, T> | undefined {
  const { [key]: _removed, ...rest } = inner ?? {};
  const next: Record<string, T> =
    value === null ? rest : { ...rest, [key]: value };
  return Object.keys(next).length ? next : undefined;
}

/** `outer[id] = inner`, dropping the entry when `inner` is undefined. */
function setEntry<T>(
  outer: Record<string, T>,
  id: string,
  inner: T | undefined,
) {
  if (inner === undefined) delete outer[id];
  else outer[id] = inner;
}

/** Writes `value` at `address`. `null` clears the override, dropping any container it leaves
 * empty. */
export function writeInput(
  build: Build,
  address: InputAddress,
  value: number | boolean | null,
) {
  switch (address.store) {
    case "values": {
      const slot = { ...build.values[address.slotId] };
      setEntry(
        slot,
        address.kind,
        withKey(slot[address.kind], address.key, toNumber(value)),
      );
      setEntry(
        build.values,
        address.slotId,
        Object.keys(slot).length ? slot : undefined,
      );
      return;
    }
    case "bonusValues": {
      build.bonusValues ??= {};
      const bonus = { ...build.bonusValues[address.bonusId] };
      if (address.kind === "input")
        setEntry(bonus, "input", withKey(bonus.input, address.key, value));
      else
        setEntry(
          bonus,
          address.kind,
          withKey(bonus[address.kind], address.key, toNumber(value)),
        );
      setEntry(
        build.bonusValues,
        address.bonusId,
        Object.keys(bonus).length ? bonus : undefined,
      );
      return;
    }
    case "occurrenceInputs":
      setEntry(
        build.occurrenceInputs,
        address.itemId,
        withKey(
          build.occurrenceInputs[address.itemId],
          address.bonusId,
          toNumber(value),
        ),
      );
      return;
    case "assignments":
      setEntry(
        build.assignments,
        address.slotId,
        withKey(
          build.assignments[address.slotId],
          address.itemId,
          toNumber(value),
        ),
      );
      return;
    case "context":
      setPath(build.context, address.path, value);
      return;
  }
}

const toNumber = (value: number | boolean | null) =>
  value === null ? null : Number(value);

/** A stable string for `address`: a history coalescing key, or a key to match two builds'
 * values by. */
export function inputKey(address: InputAddress): string {
  switch (address.store) {
    case "values":
      return `values:${address.slotId}:${address.kind}:${address.key}`;
    case "bonusValues":
      return `bonusValues:${address.bonusId}:${address.kind}:${address.key}`;
    case "occurrenceInputs":
      return `occurrenceInputs:${address.itemId}:${address.bonusId}`;
    case "assignments":
      return `assignments:${address.slotId}:${address.itemId}`;
    case "context":
      return `context:${address.path}`;
  }
}

/** Where an item's own dynamic stat is stored. */
export const itemStatAddress = (
  slotId: string,
  stat: string,
): InputAddress => ({ store: "values", slotId, kind: "stat", key: stat });

/** Where a bonus's grant/variant dynamic stat is stored. */
export const bonusStatAddress = (
  bonusId: string,
  stat: string,
): InputAddress => ({ store: "bonusValues", bonusId, kind: "stat", key: stat });
