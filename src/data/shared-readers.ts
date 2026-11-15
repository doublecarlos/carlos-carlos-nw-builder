// The bonuses reading a shared picker. A bonus reads one when its conditions test, through an
// `equipped` leaf, a tag one of the slot's candidates carries or one of the candidates by id.
// Formula `tagged()` and `equipped()` reads count too. Readers are derived, never declared, so
// a read can never lack a control.
import { formulaSites, parseFormula } from "../engine/formula";
import type { Bonus, ConditionWhen, Item } from "../types";

/** What a bonus tests through `equipped`: tags and item ids. */
export interface EquippedReads {
  tags: Set<string>;
  items: Set<string>;
}

function walk(when: ConditionWhen | undefined, out: EquippedReads) {
  if (!when || typeof when !== "object") return;
  for (const [key, spec] of Object.entries(when)) {
    if (key === "all" || key === "any") {
      if (Array.isArray(spec))
        for (const sub of spec) walk(sub as ConditionWhen, out);
    } else if (key === "not") walk(spec as ConditionWhen, out);
    else if (key === "equipped" && spec && typeof spec === "object") {
      const { tag, item } = spec as { tag?: unknown; item?: unknown };
      if (typeof tag === "string" && tag) out.tags.add(tag);
      if (typeof item === "string" && item) out.items.add(item);
    }
  }
}

const readsCache = new WeakMap<Bonus, EquippedReads>();

/** Every tag and item `bonus` tests through `equipped`, in conditions and formulas. */
export function equippedReads(bonus: Bonus): EquippedReads {
  const cached = readsCache.get(bonus);
  if (cached) return cached;
  const out: EquippedReads = { tags: new Set(), items: new Set() };
  for (const grant of bonus.grants ?? []) {
    walk(grant.when, out);
    for (const variant of grant.variants ?? []) walk(variant.when, out);
  }
  for (const { ref } of formulaSites(bonus)) {
    if (typeof ref?.formula !== "string") continue;
    const { reads } = parseFormula(ref.formula);
    for (const tag of reads.tags) out.tags.add(tag);
    for (const item of reads.items) out.items.add(item);
  }
  readsCache.set(bonus, out);
  return out;
}

/** The tags of `candidates` that `bonus` tests, which make it a reader. */
export function readerTags(
  bonus: Bonus,
  candidates: readonly Item[],
): string[] {
  const { tags } = equippedReads(bonus);
  const carried = new Set(candidates.flatMap((item) => item.tags ?? []));
  return [...tags].filter((tag) => carried.has(tag));
}

/** Whether `bonus` reads a slot offering `candidates`. A candidate's own bonuses do not read
 *  its own slot. */
export function readsCandidates(
  bonus: Bonus,
  candidates: readonly Item[],
): boolean {
  if (candidates.some((item) => item.bonuses?.includes(bonus.id))) return false;
  const { items } = equippedReads(bonus);
  return (
    candidates.some((item) => items.has(item.id)) ||
    readerTags(bonus, candidates).length > 0
  );
}

/** The ids of the bonuses reading each shared picker, by its slot id, in catalog order. */
export function sharedPickerReaders(
  pickers: readonly { id: string; candidates: readonly Item[] }[],
  bonuses: readonly Bonus[],
): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const { id, candidates } of pickers) {
    const readers = bonuses
      .filter((bonus) => readsCandidates(bonus, candidates))
      .map((bonus) => bonus.id);
    map.set(id, readers);
  }
  return map;
}
