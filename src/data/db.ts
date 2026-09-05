// Item database indexing.
//
// Consumes the statically-imported data (src/data.ts) and builds the lookups the engine and UI
// need. Pure: no DOM, no fetch -- `build()` takes items/bonuses/schema/slots as plain
// arguments so catalog.ts can hand it a composed (base + overlay) catalogue instead.

import { NW_ITEMS, NW_BONUSES, NW_SCHEMA, NW_SLOTS } from "./data";
import { bonusIdOf } from "../lib/bonus-attachment";
import { replacementIdOf, replacementValuesOf } from "../lib/item-replacement";
import { resolvedOptions } from "../lib/param-options";
import { parseRowSlotId, rowSlot } from "../lib/item-picker-list";
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

/**
 * Presentation order for a picker's candidates: highest item level first, name as tiebreak.
 *
 * `il` leads because it is the number players already rank gear by and the picker renders it on
 * every row, so the resulting order is verifiable on screen rather than being an opaque score.
 * The tiebreak carries more weight than it looks: only about half the catalogue has an `il` at
 * all (boons, group buffs, powers and leveling entries carry none) and several large categories
 * share a single value across every member, so for those slots the name comparison *is* the
 * sort -- it has to be deterministic, not incidental.
 */
const byItemLevel = (a: Item, b: Item) =>
  (Number(b.il) || 0) - (Number(a.il) || 0) || a.name.localeCompare(b.name);

/** Cap on `replacedBy` hops: a longer chain is authoring damage, not a real case. */
const REPLACEMENT_DEPTH = 8;

/**
 * The item a retired id would migrate to, or null when there is none.
 *
 * Not consulted by `Db.get`: a retirement is an offer, so a build keeps reading as the item it
 * holds until the player accepts. A cycle, dangle or over-long chain stops on the last entry
 * that resolved; `validateReplacements` reports all three.
 */
function endOfChain(byId: Map<string, Item>, id: string): Item | null {
  let item = byId.get(id) ?? null;
  const seen = new Set<string>([id]);
  for (let hop = 0; hop < REPLACEMENT_DEPTH; hop++) {
    if (!item?.replacedBy) break;
    const next = replacementIdOf(item.replacedBy);
    if (seen.has(next)) break;
    const replacement = byId.get(next);
    if (!replacement) break;
    seen.add(next);
    item = replacement;
  }
  return item && item.id !== id ? item : null;
}

/** Values a retired id carries forward, merged along the chain with a later hop winning. */
function collectSeeds(
  byId: Map<string, Item>,
  id: string,
): Record<string, number> {
  const seeds: Record<string, number> = {};
  let item = byId.get(id) ?? null;
  const seen = new Set<string>([id]);
  for (let hop = 0; hop < REPLACEMENT_DEPTH; hop++) {
    if (!item?.replacedBy) break;
    const next = replacementIdOf(item.replacedBy);
    if (seen.has(next)) break;
    const replacement = byId.get(next);
    if (!replacement) break;
    for (const [stat, value] of Object.entries(
      replacementValuesOf(item.replacedBy),
    )) {
      if (value !== undefined) seeds[stat] = value;
    }
    seen.add(next);
    item = replacement;
  }
  return seeds;
}

/** Whether a slot still offers `item`. `inUse` exempts what the build already holds, so a
 *  hidden pick can be cleared and re-selected rather than being a one-way door. */
export const stillOffered = (item: Item, inUse: boolean) =>
  inUse || !item.hideFromPicker;

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
  const itemByGameId = new Map<string, string[]>(); // Hitem -> [item id]
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
    for (const gameId of item.gameIds ?? [])
      pushTo(itemByGameId, gameId, item.id);
  }

  for (const list of byFilter.values()) {
    list.sort(byItemLevel);
  }

  // Shared bonuses, keyed by id. Membership is never listed here -- it lives on the
  // items (`bonuses: [...]`), so this is the only place the two are joined.
  const bonusById = new Map(bonuses.map((bonus) => [bonus.id, bonus]));

  // A `list` param declaring `optionsFrom` gets its `options` resolved here, once, so every
  // consumer downstream (the build editor's control, the compare-diff label) reads one
  // `options` array and never has to know whether it was authored inline or derived.
  // `authoredSlots` keeps the pre-resolution form for the write side -- see `Db`.
  const authoredSlots = slots?.slots ?? [];
  const slotList = authoredSlots.map((slot) =>
    slot.type === "build_parameter" && slot.optionsFrom
      ? { ...slot, options: resolvedOptions(slot, items) }
      : slot,
  );
  const slotById = new Map<string, Slot>(
    slotList.map((slot) => [slot.id, slot]),
  );

  /** An authored slot, or the row an `item_picker_list` id addresses -- rows are not in
   * `slotById`, since how many exist is a property of the build, not the catalogue. */
  const slotFor = (slotId: string): Slot | undefined => {
    const authored = slotById.get(slotId);
    if (authored) return authored;
    const row = parseRowSlotId(slotId);
    if (!row) return undefined;
    const list = slotById.get(row.listId);
    return list?.type === "item_picker_list"
      ? rowSlot(list, row.index)
      : undefined;
  };

  return {
    items,
    schema,
    slots: slotList,
    authoredSlots,
    sections: slots?.sections ?? [],
    presets: slots?.presets ?? [],
    slotById,
    slotFor,
    bonuses,
    bonusById,
    bonusMembers,
    itemsByTag,
    itemByGameId,
    duplicates,

    /** Look up an item by id. `-`, blank and nullish all mean "empty slot". Never follows
     * `replacedBy` -- see `endOfChain`. */
    get(id: string | null | undefined) {
      if (id == null || id === "" || id === "-") return null;
      return byId.get(id) ?? null;
    },

    /** See `Db.replacementFor`. */
    replacementFor(id: string | null | undefined) {
      if (id == null || id === "" || id === "-") return null;
      return endOfChain(byId, id);
    },

    /** See `Db.replacementSeeds`. */
    replacementSeeds(id: string | null | undefined) {
      if (id == null || id === "" || id === "-") return {};
      return collectSeeds(byId, id);
    },

    /** Items selectable in a filter category, in `byItemLevel` order. */
    forFilter: (filter: string) => byFilter.get(filter) ?? [],

    /** Items selectable in a given slot id -- empty for a build_parameter slot, which has no
     * `filter` to look up (it isn't an item choice at all). An item_picker slot resolves by
     * `tags` when set (union across every listed tag, de-duplicated, via `itemsByTag`) or by
     * `filter` otherwise -- `types.ts`'s `ItemPickerSlot` treats the two as mutually exclusive.
     * An `item_picker_list` container answers with what its rows offer, resolved the same way,
     * so a caller holding only the container needs no row to ask through.
     * For a point_assignment slot, only items that also carry `inlineRepetition` bounds qualify
     * (an item merely sharing the filter but missing that config could never render a valid
     * stepper), sorted by `inlineRepetition.priority` (default 0) then name -- item_picker's own
     * `byItemLevel` order doesn't apply here since a priority is how a point_assignment row's
     * author controls display order without an explicit list to reorder (slots.json used to hold
     * one), and these rows are all visible at once rather than being scanned in a dropdown. */
    forSlot(slotId: string) {
      const slot = slotFor(slotId);
      if (slot?.type === "item_picker" || slot?.type === "item_picker_list") {
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
          return matches.sort(byItemLevel);
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

/**
 * The value this build currently publishes at `path`, from whatever it has equipped
 * (`Item.publishes`). The `Db`-level counterpart to bonus.ts's fold in `collect()`, for the
 * call sites that need one published value without resolving the whole build -- picker
 * filtering runs on every keystroke, and resolving a build to answer "which class is this"
 * would be absurd. Conflicts are the engine's business (`publishConflicts`); this just takes
 * the first, since a conflicted build is already reporting an error of its own.
 */
export function publishedValue(
  db: Db,
  build: Build,
  path: string,
): string | number | boolean | undefined {
  for (const id of Object.values(build.choices ?? {})) {
    const value = db.get(id)?.publishes?.[path];
    if (value !== undefined) return value;
  }
  return undefined;
}

/**
 * The id of the item that publishes `value` at `path` -- the inverse lookup, for translating
 * an outside identifier into the item that now stands for it: a game import's class name, or
 * a pre-migration build's stored `context.class` (storage.ts's `migrateClassToChoice`).
 */
export function itemPublishing(
  db: Db,
  path: string,
  value: string | number | boolean,
): string | undefined {
  return db.items.find((item) => item.publishes?.[path] === value)?.id;
}

/** A slot's candidate and, when the picker would normally withhold it, the reason it gives.
 * `null` for a candidate offered as usual. */
export interface SlotCandidate {
  item: Item;
  hidden: string | null;
}

/** Display name per published class value, so a reason can read "Wizard only" instead of
 * repeating the raw published id. Built once per candidate list rather than per candidate. */
function classNames(db: Db): Map<string, string> {
  const names = new Map<string, string>();
  for (const item of db.items) {
    const value = item.publishes?.class;
    if (typeof value === "string" && !names.has(value))
      names.set(value, item.name);
  }
  return names;
}

/**
 * Every candidate `db.forSlot(slotId)` offers, each tagged with why the picker withholds it:
 * retired (`Item.hideFromPicker`), restricted to another class, or already at its `maxCopies`
 * cap. All three are states the engine can already describe once reached (`checkItemErrors`),
 * so the filters exist only to close the "succeeds then flagged" gap -- which is why a caller
 * can ask for the withheld ones back and get a reason to show beside each.
 *
 * An unset class constrains nothing -- defaulting to empty, a fresh build would otherwise
 * withhold every class-restricted item.
 */
export function slotCandidates(
  db: Db,
  slotId: string,
  build: Build,
): SlotCandidate[] {
  // Published by the equipped class item rather than stored on the build -- `options.class` is
  // an ordinary item_picker now, so `context.class` no longer exists.
  const cls = publishedValue(db, build, "class") as string | undefined;
  const slot = db.slotFor(slotId);
  const counts =
    slot?.type === "item_picker" ? copyCounts(db, build, slotId) : null;
  const equipped = build.choices?.[slotId];
  let names: Map<string, string> | null = null;

  return db.forSlot(slotId).map((item) => {
    let hidden: string | null = null;
    if (!stillOffered(item, item.id === equipped)) {
      hidden = "retired";
    } else if (item.allowedClass && cls && !item.allowedClass.includes(cls)) {
      names ??= classNames(db);
      hidden = `${item.allowedClass.map((id) => names!.get(id) ?? id).join(" or ")} only`;
    } else if (counts) {
      const max = db.maxCopies(item);
      const used = counts.get(item.id) ?? 0;
      if (max && used >= max) hidden = `${used}/${max} copies`;
    }
    return { item, hidden };
  });
}

/** `slotCandidates` narrowed to what the slot actually offers. `includeHidden` re-admits the
 * withheld ones, for the build editor's "show unavailable" lens. */
export function forSlotAndBuild(
  db: Db,
  slotId: string,
  build: Build,
  { includeHidden = false }: { includeHidden?: boolean } = {},
): Item[] {
  const candidates = slotCandidates(db, slotId, build);
  return (includeHidden ? candidates : candidates.filter((c) => !c.hidden)).map(
    (c) => c.item,
  );
}

/** Reason per withheld candidate, keyed by item id -- what a picker showing them needs to say
 * why each is there. */
export function hiddenReasons(
  db: Db,
  slotId: string,
  build: Build,
): Map<string, string> {
  const reasons = new Map<string, string>();
  for (const { item, hidden } of slotCandidates(db, slotId, build)) {
    if (hidden) reasons.set(item.id, hidden);
  }
  return reasons;
}

/** One slot whose stored item id has been superseded, and what it now resolves to. */
export interface RetiredChoice {
  slotId: string;
  /** The id the build still holds. */
  from: string;
  /** The item `from` resolves to now. */
  to: Item;
}

/** Every `item_picker` choice naming a superseded item. Drives the offer only; the build
 *  holds and calculates as the saved item until someone accepts. */
export function retiredChoices(db: Db, build: Build): RetiredChoice[] {
  const retired: RetiredChoice[] = [];
  for (const [slotId, itemId] of Object.entries(build.choices ?? {})) {
    if (!itemId) continue;
    const to = db.replacementFor(itemId);
    if (to) retired.push({ slotId, from: itemId, to });
  }
  return retired;
}
