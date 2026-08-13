// Item database indexing.
//
// Consumes the statically-imported data (src/data.ts) and builds the lookups the engine and UI
// need. Pure: no DOM, no fetch -- `build()` takes items/bonuses/schema/slots as plain
// arguments so catalog.ts can hand it a composed (base + overlay) catalogue instead.

import { NW_ITEMS, NW_BONUSES, NW_SCHEMA, NW_SLOTS } from "./data";
import { bonusIdOf } from "../lib/bonus-attachment";
import type {
  Item,
  Bonus,
  Schema,
  SlotsData,
  Slot,
  Db,
  BonusCandidate,
  Build,
} from "../types";

const pushTo = <K>(map: Map<K, string[]>, key: K, value: string) => {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
};

export function build(
  items: Item[],
  bonuses: Bonus[] = [],
  schema: Schema,
  slots: SlotsData,
): Db {
  const byId = new Map<string, Item>();
  // Keyed by `string | undefined` (not just `string`): an item with no `filter` still lands
  // here under the `undefined` key -- dead weight (`forFilter` is only ever called with a
  // real string) but preserved rather than silently dropped.
  const byFilter = new Map<string | undefined, Item[]>();
  const bonusMembers = new Map<string, string[]>(); // bonusId -> [item id]
  const itemsByTag = new Map<string, string[]>(); // tag   -> [item id]
  const itemByGameId = new Map<string, string>(); // Hitem -> item id
  const duplicates: string[] = [];

  for (const item of items) {
    if (byId.has(item.id)) duplicates.push(item.id);
    byId.set(item.id, item);
    const filterList = byFilter.get(item.filter);
    if (filterList) filterList.push(item);
    else byFilter.set(item.filter, [item]);

    for (const attachment of item.bonuses ?? [])
      pushTo(bonusMembers, bonusIdOf(attachment), item.id);
    for (const tag of item.tags ?? []) pushTo(itemsByTag, tag, item.id);
    for (const gameId of item.gameIds ?? []) itemByGameId.set(gameId, item.id);
  }

  for (const list of byFilter.values()) {
    list.sort((a, b) => a.name.localeCompare(b.name));
  }

  // Shared bonuses, keyed by id. Membership is never listed here -- it lives on the
  // items (`bonuses: [...]`), so this is the only place the two are joined.
  const bonusById = new Map(bonuses.map((bonus) => [bonus.id, bonus]));
  const slotList = slots?.slots ?? [];
  const slotById = new Map<string, Slot>(
    slotList.map((slot) => [slot.id, slot]),
  );

  return {
    items,
    schema,
    slots: slotList,
    sections: slots?.sections ?? [],
    presets: slots?.presets ?? [],
    slotById,
    bonuses,
    bonusById,
    bonusMembers,
    itemsByTag,
    itemByGameId,
    duplicates,

    /** Look up an item by id. `-`, blank and nullish all mean "empty slot". */
    get(id: string | null | undefined) {
      if (id == null || id === "" || id === "-") return null;
      return byId.get(id) ?? null;
    },

    /** Items selectable in a filter category, sorted by name. */
    forFilter: (filter: string) => byFilter.get(filter) ?? [],

    /** Items selectable in a given slot id -- empty for a build_parameter slot, which has no
     * `filter` to look up (it isn't an item choice at all). An item_picker slot resolves by
     * `tags` when set (union across every listed tag, de-duplicated, via `itemsByTag`) or by
     * `filter` otherwise -- `types.ts`'s `ItemPickerSlot` treats the two as mutually exclusive.
     * For a point_assignment slot, only items that also carry `inlineRepetition` bounds qualify
     * (an item merely sharing the filter but missing that config could never render a valid
     * stepper), sorted by `inlineRepetition.priority` (default 0) then name -- item_picker's own
     * name-only order doesn't apply here since a priority is how a point_assignment row's author
     * controls display order without an explicit list to reorder (slots.json used to hold one). */
    forSlot(slotId: string) {
      const slot = slotById.get(slotId);
      if (slot?.type === "item_picker") {
        if (slot.tags?.length) {
          const seen = new Set<string>();
          const matches: Item[] = [];
          for (const tag of slot.tags) {
            for (const id of itemsByTag.get(tag) ?? []) {
              if (seen.has(id)) continue;
              seen.add(id);
              const item = byId.get(id);
              if (item) matches.push(item);
            }
          }
          return matches.sort((a, b) => a.name.localeCompare(b.name));
        }
        return byFilter.get(slot.filter) ?? [];
      }
      if (slot?.type === "point_assignment") {
        return (byFilter.get(slot.filter) ?? [])
          .filter((item) => item.inlineRepetition)
          .sort((a, b) => {
            const diff =
              (a.inlineRepetition!.priority ?? 0) -
              (b.inlineRepetition!.priority ?? 0);
            return diff !== 0 ? diff : a.name.localeCompare(b.name);
          });
      }
      return [];
    },

    /** 0 or absent means unlimited. */
    maxCopies: (item: Item | null | undefined) => item?.maxCopies ?? 0,

    /**
     * Every bonus an item contributes: every bonus it belongs to, whether that bonus has
     * one member (a bonus that is nobody else's business) or many. One candidate per bonus --
     * a bonus resolves as one unit (bonus.js sums its `grants`), not one candidate per grant.
     */
    bonusesFor(item: Item): BonusCandidate[] {
      return (item.bonuses ?? []).flatMap((attachment) => {
        const bonus = bonusById.get(bonusIdOf(attachment));
        return bonus ? [{ bonus, bonusId: bonus.id, source: item.name }] : [];
      });
    },
  };
}

/** Convenience for tests/tooling: build from the statically-imported data (src/data.ts), no
 * `window` required. */
export const fromData = () => build(NW_ITEMS, NW_BONUSES, NW_SCHEMA, NW_SLOTS);

/** Every item id's current copy count across the build, tallied the same way `findErrors`
 * (engine.ts) counts for its `maxCopies` check -- but cheap: no `resolveBuild()` call, just the
 * raw ids `build.choices`/`build.assignments` already hold. `excludeSlotId`'s own choice is left
 * out of the tally so an item_picker slot never counts its own currently-equipped item against
 * itself -- re-selecting it should never read as "would exceed". */
function copyCounts(
  db: Db,
  build: Build,
  excludeSlotId: string,
): Map<string, number> {
  const counts = new Map<string, number>();
  const bump = (id: string, by: number) =>
    counts.set(id, (counts.get(id) ?? 0) + by);

  for (const [slotId, itemId] of Object.entries(build.choices ?? {})) {
    if (slotId !== excludeSlotId && itemId) bump(itemId, 1);
  }
  for (const slot of db.slots) {
    if (slot.type !== "point_assignment") continue;
    const assigned = build.assignments?.[slot.id] ?? {};
    for (const item of db.forSlot(slot.id)) {
      const count = assigned[item.id] ?? item.inlineRepetition!.default;
      if (count > 0) bump(item.id, count);
    }
  }
  return counts;
}

/** `db.forSlot(slotId)`, narrowed to what `build.context.class` actually allows and, for an
 * item_picker slot, to what its `maxCopies` cap still has room for (issue #198) -- the same
 * "succeeds then flagged" gap #196's `hideFromPicker` closed for problem grants, closed here for
 * the far more common maxCopies case via a dedicated cheap check instead of routing through the
 * bonus/condition system. An unset class constrains nothing -- defaulting to empty, a fresh
 * build would otherwise hide every class-restricted item with no explanation. */
export function forSlotAndBuild(db: Db, slotId: string, build: Build): Item[] {
  const cls = build.context.class;
  const slot = db.slotById.get(slotId);
  const counts =
    slot?.type === "item_picker" ? copyCounts(db, build, slotId) : null;
  return db
    .forSlot(slotId)
    .filter(
      (item) => !item.allowedClass || !cls || item.allowedClass.includes(cls),
    )
    .filter((item) => {
      if (!counts) return true;
      const max = db.maxCopies(item);
      return !max || (counts.get(item.id) ?? 0) < max;
    });
}
