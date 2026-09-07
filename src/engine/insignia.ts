// The stable: which insignia a mount's slots accept, which slots upgrade an insignia to its
// preferred variant, and which bonus a group of slotted insignia produces.
//
// Everything is derived from the catalogue, never stored on a build. A group resolves by shape
// alone; an insignia's type carries only its stats.

import { INSIGNIA_SHAPES } from "../types";
import type {
  Db,
  Item,
  Build,
  InsigniaShape,
  InsigniaSlotSpec,
  StableSlotRef,
} from "../types";

/** One group's slot ids. `mount` and `bonus` are null when the group declares no such row. */
interface StableGroup {
  group: number;
  mount: string | null;
  bonus: string | null;
  /** In declared `index` order, so position here is position on the mount. */
  insignia: string[];
}

interface StableIndex {
  byId: Map<string, StableSlotRef>;
  groups: StableGroup[];
  byGroup: Map<number, StableGroup>;
}

const indexCache = new WeakMap<Db, StableIndex>();

/** Read off `ItemPickerSlot.stable`, never off slot ids, so slots.json may rename or reorder
 * stable rows freely. Memoised per `Db` as lib/bonus-slots.ts does. */
function stableIndex(db: Db): StableIndex {
  const memoized = indexCache.get(db);
  if (memoized) return memoized;

  const byId = new Map<string, StableSlotRef>();
  const byGroup = new Map<number, StableGroup>();
  const ordering = new Map<string, number>();

  for (const slot of db.slots) {
    if (slot.type !== "item_picker" || !slot.stable) continue;
    const ref = slot.stable;
    byId.set(slot.id, ref);
    let group = byGroup.get(ref.group);
    if (!group) {
      group = { group: ref.group, mount: null, bonus: null, insignia: [] };
      byGroup.set(ref.group, group);
    }
    if (ref.role === "mount") group.mount = slot.id;
    else if (ref.role === "bonus") group.bonus = slot.id;
    else {
      ordering.set(slot.id, ref.index ?? group.insignia.length + 1);
      group.insignia.push(slot.id);
    }
  }

  for (const group of byGroup.values()) {
    group.insignia.sort(
      (a, b) => (ordering.get(a) ?? 0) - (ordering.get(b) ?? 0),
    );
  }
  const groups = [...byGroup.values()].sort((a, b) => a.group - b.group);
  const built = { byId, groups, byGroup };
  indexCache.set(db, built);
  return built;
}

export const stableGroups = (db: Db) => stableIndex(db).groups;

export const stableRef = (db: Db, slotId: string): StableSlotRef | null =>
  stableIndex(db).byId.get(slotId) ?? null;

const groupOf = (db: Db, group: number): StableGroup | undefined =>
  stableIndex(db).byGroup.get(group);

export const mountSlotId = (db: Db, group: number) =>
  groupOf(db, group)?.mount ?? null;
export const bonusSlotId = (db: Db, group: number) =>
  groupOf(db, group)?.bonus ?? null;
export const insigniaSlotIds = (db: Db, group: number) =>
  groupOf(db, group)?.insignia ?? [];

const mountOf = (db: Db, build: Build, group: number) => {
  const slotId = mountSlotId(db, group);
  return slotId ? (db.get(build.choices?.[slotId]) ?? null) : null;
};

/** Undefined when the group has no mount, which leaves it in its manual fallback. */
export function specForSlot(
  db: Db,
  build: Build,
  slotId: string,
): InsigniaSlotSpec | undefined {
  const ref = stableRef(db, slotId);
  if (ref?.role !== "insignia") return undefined;
  const position = insigniaSlotIds(db, ref.group).indexOf(slotId);
  if (position < 0) return undefined;
  return mountOf(db, build, ref.group)?.insigniaSlots?.[position];
}

/** A fixed slot never grants preferred status however well the shape matches. */
export const isPreferredSlot = (
  spec: InsigniaSlotSpec | undefined,
  shape: InsigniaShape | undefined,
) => Boolean(spec?.universal && spec.preferred && shape === spec.preferred);

/** A universal slot accepts every shape; its `preferred` is an upgrade, not a restriction. */
export const slotAccepts = (
  spec: InsigniaSlotSpec | undefined,
  shape: InsigniaShape | undefined,
) => {
  if (!spec) return true;
  if (spec.universal) return true;
  return spec.shape === shape;
};

/** One slot's rule in words, short enough to stand in for a row's label. */
export function describeSlotSpec(spec: InsigniaSlotSpec): string {
  if (!spec.universal) return String(spec.shape);
  return spec.preferred ? `universal (${spec.preferred})` : "universal";
}

/** A whole mount's slots in one line. */
export const slotLine = (mount: Item) =>
  (mount.insigniaSlots ?? []).map(describeSlotSpec).join(", ");

/** `slotLine` labelled, for the surfaces that show it beside other text. Empty for anything
 * that is not a mount. */
export const slotSummary = (item: Item) =>
  item.insigniaSlots ? `Slots: ${slotLine(item)}` : "";

/** Multiset equality: a recipe names shapes, not which slot each goes in. */
function sameShapes(a: readonly string[], b: readonly string[]) {
  if (a.length !== b.length) return false;
  const counts = new Map<string, number>();
  for (const shape of a) counts.set(shape, (counts.get(shape) ?? 0) + 1);
  for (const shape of b) {
    const left = counts.get(shape);
    if (!left) return false;
    counts.set(shape, left - 1);
  }
  return true;
}

const recipeCache = new WeakMap<Db, { four: Item[]; three: Item[] }>();

/** Every recipe-carrying item, split by recipe length. Memoised: the reference tables ask once
 * per mount-and-bonus pairing. */
function recipes(db: Db) {
  const memoized = recipeCache.get(db);
  if (memoized) return memoized;

  const four: Item[] = [];
  const three: Item[] = [];
  for (const item of db.items) {
    const recipe = item.insigniaRecipe;
    if (!recipe) continue;
    if (recipe.length === 4) four.push(item);
    else if (recipe.length === 3) three.push(item);
  }
  const built = { four, three };
  recipeCache.set(db, built);
  return built;
}

/** Four-shape recipes first, then three-shape ones against the first three slots. A hole in the
 * slots being matched disqualifies that pass. */
export function matchBonus(
  db: Db,
  shapes: (InsigniaShape | undefined)[],
): Item | null {
  const { four, three } = recipes(db);
  const all = shapes.slice(0, 4);
  if (all.length === 4 && all.every(Boolean)) {
    const match = four.find((item) =>
      sameShapes(item.insigniaRecipe!, all as string[]),
    );
    if (match) return match;
  }
  const first = shapes.slice(0, 3);
  if (first.length === 3 && first.every(Boolean)) {
    const match = three.find((item) =>
      sameShapes(item.insigniaRecipe!, first as string[]),
    );
    if (match) return match;
  }
  return null;
}

// --- reachability -----------------------------------------------------------------------------

/** De-duplicated, since recipes repeat shapes. */
function orderings(shapes: readonly string[]): string[][] {
  const seen = new Set<string>();
  const out: string[][] = [];
  const walk = (left: string[], acc: string[]) => {
    if (!left.length) {
      const key = acc.join("|");
      if (!seen.has(key)) {
        seen.add(key);
        out.push([...acc]);
      }
      return;
    }
    for (let i = 0; i < left.length; i++) {
      walk([...left.slice(0, i), ...left.slice(i + 1)], [...acc, left[i]]);
    }
  };
  walk([...shapes], []);
  return out;
}

/** One entry per slot; `undefined` leaves that slot empty. */
interface Arrangement {
  shapes: (InsigniaShape | undefined)[];
  preferred: number;
}

const preferredCount = (
  specs: InsigniaSlotSpec[],
  shapes: (InsigniaShape | undefined)[],
) => shapes.filter((shape, i) => isPreferredSlot(specs[i], shape)).length;

/** More preferences met, then more slots filled. */
function better(a: Arrangement, b: Arrangement | null) {
  if (!b) return true;
  if (a.preferred !== b.preferred) return a.preferred > b.preferred;
  return a.shapes.filter(Boolean).length > b.shapes.filter(Boolean).length;
}

/**
 * The best way to fill `mount` so that it produces `bonus`, or null when it cannot.
 *
 * A three-shape recipe leaves one slot spare. That slot may hold any shape except one
 * completing a four-shape recipe, which would displace the bonus being aimed at.
 */
export function bestArrangement(
  db: Db,
  mount: Item,
  bonus: Item,
): Arrangement | null {
  const recipe = bonus.insigniaRecipe;
  const specs = mount.insigniaSlots;
  if (!recipe || !specs || specs.length < recipe.length) return null;

  // At most one slot is ever spare: recipes are three or four shapes, mounts three or four slots.
  const spare = specs.length > recipe.length ? recipe.length : -1;
  const { four } = recipes(db);
  const completesFour = (shapes: InsigniaShape[]) =>
    four.some((item) => sameShapes(item.insigniaRecipe!, shapes));

  let best: Arrangement | null = null;
  for (const order of orderings(recipe)) {
    if (!order.every((shape, i) => slotAccepts(specs[i], shape))) continue;
    const candidates: (InsigniaShape | undefined)[] =
      spare === -1
        ? [undefined]
        : [
            undefined,
            // Only shapes the catalogue supplies, so a pairing counts as reachable in practice.
            ...INSIGNIA_SHAPES.filter(
              (shape) =>
                slotAccepts(specs[spare], shape) &&
                insigniaOfShape(db, shape) &&
                !completesFour([...order, shape]),
            ),
          ];
    for (const extra of candidates) {
      const shapes: (InsigniaShape | undefined)[] =
        spare === -1 ? [...order] : [...order, extra];
      const arrangement = { shapes, preferred: preferredCount(specs, shapes) };
      if (better(arrangement, best)) best = arrangement;
    }
  }
  return best;
}

/** `preferred` is how many of the mount's preferred slots the best arrangement satisfies. */
export interface Reach {
  mount: Item;
  bonus: Item;
  preferred: number;
}

const reachFor = (db: Db, mount: Item, bonus: Item): Reach | null => {
  const best = bestArrangement(db, mount, bonus);
  return best ? { mount, bonus, preferred: best.preferred } : null;
};

const catalogueCache = new WeakMap<Db, { mounts: Item[]; bonuses: Item[] }>();

/** Memoised per `Db`: a picker row asks on every build change, and both are a full scan. */
function stableCatalogue(db: Db) {
  let split = catalogueCache.get(db);
  if (!split) {
    split = {
      mounts: db.items.filter((item) => item.insigniaSlots),
      bonuses: db.items.filter((item) => item.insigniaRecipe),
    };
    catalogueCache.set(db, split);
  }
  return split;
}

export const allMounts = (db: Db) => stableCatalogue(db).mounts;
export const allBonuses = (db: Db) => stableCatalogue(db).bonuses;

/** Best-preferred first, then by name. */
export function reachableBonuses(db: Db, mount: Item): Reach[] {
  return allBonuses(db)
    .map((bonus) => reachFor(db, mount, bonus))
    .filter((r): r is Reach => !!r)
    .sort(
      (a, b) =>
        b.preferred - a.preferred || a.bonus.name.localeCompare(b.bonus.name),
    );
}

/** Best-preferred first, then by name. */
export function mountsFor(db: Db, bonus: Item): Reach[] {
  return allMounts(db)
    .map((mount) => reachFor(db, mount, bonus))
    .filter((r): r is Reach => !!r)
    .sort(
      (a, b) =>
        b.preferred - a.preferred || a.mount.name.localeCompare(b.mount.name),
    );
}

/** The ordinary half of a pair, highest item level first, name as a stable tiebreak. Built for
 * every shape at once: `bestArrangement` asks per shape per ordering per pairing. */
const bestByShape = new WeakMap<Db, Map<string, Item | null>>();

function insigniaOfShape(db: Db, shape: string): Item | null {
  let byShape = bestByShape.get(db);
  if (!byShape) {
    byShape = new Map();
    const candidates = db.items
      .filter(
        (item) =>
          item.insigniaShape && item.preferredVariant && !item.hideFromPicker,
      )
      .sort(
        (a, b) =>
          (Number(b.il) || 0) - (Number(a.il) || 0) ||
          a.name.localeCompare(b.name),
      );
    for (const item of candidates) {
      if (!byShape.has(item.insigniaShape!))
        byShape.set(item.insigniaShape!, item);
    }
    bestByShape.set(db, byShape);
  }
  return byShape.get(shape) ?? null;
}

export interface MisplacedInsignia {
  slotId: string;
  item: Item;
  message: string;
}

/**
 * Picks that do not belong where they sit: a build edited outside the app, or one whose mount
 * was re-authored under it. Reported rather than corrected, so nothing a player cannot see
 * changes their build's numbers.
 */
export function misplacedInsignia(db: Db, build: Build): MisplacedInsignia[] {
  const found: MisplacedInsignia[] = [];
  for (const { group } of stableGroups(db)) {
    const mount = mountOf(db, build, group);
    const specs = mount?.insigniaSlots;
    if (!mount || !specs) continue;
    insigniaSlotIds(db, group).forEach((slotId, position) => {
      const item = db.get(build.choices?.[slotId]);
      if (!item?.insigniaShape) return;
      const spec = specs[position];
      if (!spec) {
        found.push({
          slotId,
          item,
          message: `${mount.name} has only ${specs.length} insignia slots`,
        });
      } else if (!slotAccepts(spec, item.insigniaShape)) {
        found.push({
          slotId,
          item,
          message: `${item.name} does not fit a ${describeSlotSpec(spec)} slot`,
        });
      } else if (
        preferredVariantIds(db).has(item.id) &&
        !isPreferredSlot(spec, item.insigniaShape)
      ) {
        found.push({
          slotId,
          item,
          message: `${item.name} only belongs in a slot preferring ${item.insigniaShape}`,
        });
      }
    });
  }
  return found;
}

/** What a group currently holds, as against `StableGroup`, which is its slots. `mount` is null
 * while the group is in its manual fallback. */
export interface StableGroupState {
  group: number;
  mount: Item | null;
  insignia: (Item | null)[];
  /** Per slot, whether it satisfied its mount's preference. */
  preferred: boolean[];
  /** Before any cap is applied. */
  bonus: Item | null;
  /** A pinned pick, which wins over `bonus`. */
  override: Item | null;
}

const shapeOf = (item: Item | null) => item?.insigniaShape;

/** Reads one group off a build without writing. */
export function readGroup(
  db: Db,
  build: Build,
  group: number,
): StableGroupState {
  const mount = mountOf(db, build, group);
  const insignia = insigniaSlotIds(db, group).map(
    (slotId) => db.get(build.choices?.[slotId]) ?? null,
  );
  const specs = mount?.insigniaSlots ?? [];
  const bonusSlot = bonusSlotId(db, group);
  return {
    group,
    mount,
    insignia,
    preferred: insignia.map((item, i) =>
      isPreferredSlot(specs[i], shapeOf(item)),
    ),
    bonus: matchBonus(db, insignia.map(shapeOf)),
    override: bonusSlot ? (db.get(build.choices?.[bonusSlot]) ?? null) : null,
  };
}

const readStable = (db: Db, build: Build) =>
  stableGroups(db).map(({ group }) => readGroup(db, build, group));

// --- what a slot's candidates lead to ----------------------------------------------------------

/** Per slot, the shape it holds; `undefined` where it is empty. */
type Held = (InsigniaShape | undefined)[];

/**
 * How many empty slots `recipe` would still need on `specs`, or null when `held` rules it out.
 *
 * `matchBonus`'s rule read forwards: a recipe takes the first `recipe.length` slots, and a
 * spare holding a shape that completes a four-shape recipe displaces the three-shape one.
 */
export function missingFor(
  db: Db,
  specs: InsigniaSlotSpec[],
  held: Held,
  recipe: readonly InsigniaShape[],
): number | null {
  if (specs.length < recipe.length) return null;

  const used: boolean[] = Array(recipe.length).fill(false);
  const walk = (k: number): boolean => {
    if (k === recipe.length) return true;
    for (let slot = 0; slot < recipe.length; slot++) {
      if (used[slot]) continue;
      if (!slotAccepts(specs[slot], recipe[k])) continue;
      if (held[slot] !== undefined && held[slot] !== recipe[k]) continue;
      used[slot] = true;
      if (walk(k + 1)) return true;
      used[slot] = false;
    }
    return false;
  };
  if (!walk(0)) return null;

  const spare = specs.length > recipe.length ? held[recipe.length] : undefined;
  if (
    spare &&
    recipes(db).four.some((item) =>
      sameShapes(item.insigniaRecipe!, [...recipe, spare]),
    )
  ) {
    return null;
  }

  let missing = 0;
  for (let slot = 0; slot < recipe.length; slot++) {
    if (held[slot] === undefined) missing++;
  }
  return missing;
}

/** What each of a group's insignia slots holds, with `skip` read as empty. */
function heldShapes(db: Db, build: Build, group: number, skip?: string): Held {
  return insigniaSlotIds(db, group).map((slotId) =>
    slotId === skip
      ? undefined
      : db.get(build.choices?.[slotId])?.insigniaShape,
  );
}

/** One heading in a universal slot's picker: the bonus, and the candidates advancing it. */
export interface InsigniaGroup {
  label: string;
  ids: string[];
}

/** The heading candidates advancing nothing sit under, kept last. */
export const NO_BONUS_GROUP = "no bonus";

/**
 * `candidates` split by the bonus each would leave reachable, closest to complete first, one
 * candidate under every bonus it advances.
 *
 * Null unless the slot is a universal one on a mount: a fixed slot's candidates all share one
 * shape, which would list the same rows under every heading.
 */
export function bonusGroupsFor(
  db: Db,
  build: Build,
  slotId: string,
  candidates: Item[],
): InsigniaGroup[] | null {
  const ref = stableRef(db, slotId);
  if (ref?.role !== "insignia") return null;
  const spec = specForSlot(db, build, slotId);
  if (!spec?.universal) return null;
  const specs = mountOf(db, build, ref.group)?.insigniaSlots;
  const position = insigniaSlotIds(db, ref.group).indexOf(slotId);
  if (!specs || position < 0) return null;

  const held = heldShapes(db, build, ref.group, slotId);
  const bonuses = allBonuses(db);

  /** Bonus ids each shape advances. A shape outside the recipe's own slots advances nothing. */
  const byShape = new Map<InsigniaShape, Set<string>>();
  for (const shape of INSIGNIA_SHAPES) {
    if (!slotAccepts(spec, shape)) continue;
    const trial = [...held];
    trial[position] = shape;
    const hits = new Set<string>();
    for (const bonus of bonuses) {
      const recipe = bonus.insigniaRecipe!;
      if (position >= recipe.length) continue;
      if (missingFor(db, specs, trial, recipe) !== null) hits.add(bonus.id);
    }
    byShape.set(shape, hits);
  }

  const advanced = new Set([...byShape.values()].flatMap((hits) => [...hits]));
  const ordered = bonuses
    .filter((bonus) => advanced.has(bonus.id))
    .map((bonus) => ({
      bonus,
      missing: missingFor(db, specs, held, bonus.insigniaRecipe!) ?? Infinity,
    }))
    .sort(
      (a, b) =>
        a.missing - b.missing || a.bonus.name.localeCompare(b.bonus.name),
    );

  const groups: InsigniaGroup[] = [];
  const placed = new Set<string>();
  for (const { bonus } of ordered) {
    const ids = candidates
      .filter((item) => byShape.get(item.insigniaShape!)?.has(bonus.id))
      .map((item) => item.id);
    if (!ids.length) continue;
    for (const id of ids) placed.add(id);
    groups.push({
      label: `${bonus.name} (${bonus.insigniaRecipe!.length} insignia)`,
      ids,
    });
  }

  const rest = candidates.filter((item) => !placed.has(item.id));
  if (rest.length) {
    groups.push({ label: NO_BONUS_GROUP, ids: rest.map((item) => item.id) });
  }
  return groups.length ? groups : null;
}

/** Bonuses one insignia short of matching, for a group deriving nothing yet. */
export function oneShortOf(db: Db, build: Build, group: number): Item[] {
  const state = readGroup(db, build, group);
  const specs = state.mount?.insigniaSlots;
  if (!specs || state.bonus) return [];
  const held = heldShapes(db, build, group);
  return allBonuses(db)
    .filter((bonus) => missingFor(db, specs, held, bonus.insigniaRecipe!) === 1)
    .sort((a, b) => a.name.localeCompare(b.name));
}

// --- preferred variants -----------------------------------------------------------------------

const upgradedIds = new WeakMap<Db, Set<string>>();

/** The upgraded half of every pair, which is exactly what `preferredVariant` points at. */
export function preferredVariantIds(db: Db): ReadonlySet<string> {
  let ids = upgradedIds.get(db);
  if (!ids) {
    ids = new Set(
      db.items
        .map((item) => item.preferredVariant)
        .filter((id): id is string => !!id),
    );
    upgradedIds.set(db, ids);
  }
  return ids;
}

export const PREFERRED_MARK = "★";

const PREF_SUFFIX = /\s*\(Pref\)$/;

export interface ItemDisplay {
  name: string;
  preferred: boolean;
}

/** How an item's name reads on screen: an upgraded insignia's `(Pref)` suffix becomes a star,
 * everything else keeps its own name. */
export function itemDisplay(
  db: Db | null | undefined,
  item: Item,
): ItemDisplay {
  const preferred = !!db && preferredVariantIds(db).has(item.id);
  return {
    name: preferred ? item.name.replace(PREF_SUFFIX, "") : item.name,
    preferred,
  };
}

/** `itemDisplay` as one string, for the places that cannot carry markup. */
export function itemLabel(db: Db | null | undefined, item: Item): string {
  const shown = itemDisplay(db, item);
  return shown.preferred ? `${shown.name} ${PREFERRED_MARK}` : shown.name;
}

/** The ordinary half of a pair, given either half. */
function baseVariant(db: Db, item: Item | null): Item | null {
  if (!item) return null;
  if (item.preferredVariant) return item;
  const owner = db.items.find((other) => other.preferredVariant === item.id);
  return owner ?? item;
}

/** The half of `item`'s pair belonging in a slot with this preferred state. */
function variantFor(
  db: Db,
  item: Item | null,
  preferred: boolean,
): Item | null {
  const base = baseVariant(db, item);
  if (!base) return null;
  if (!preferred) return base;
  return (base.preferredVariant && db.get(base.preferredVariant)) || base;
}

/**
 * Slots whose pick disagrees with the slot it sits in, and what belongs there. An empty string
 * means the slot's mount does not take that shape at all, so the pick has to go.
 */
export function normaliseGroup(
  db: Db,
  build: Build,
  group: number,
): Record<string, string> {
  const state = readGroup(db, build, group);
  const slotIds = insigniaSlotIds(db, group);
  const specs = state.mount?.insigniaSlots ?? [];
  const changes: Record<string, string> = {};
  state.insignia.forEach((item, i) => {
    if (!item) return;
    if (!slotAccepts(specs[i], item.insigniaShape)) {
      changes[slotIds[i]] = "";
      return;
    }
    const wanted = variantFor(db, item, state.preferred[i]);
    if (wanted && wanted.id !== item.id) changes[slotIds[i]] = wanted.id;
  });
  return changes;
}

// --- derived bonuses ---------------------------------------------------------------------------

export interface DerivedBonus {
  group: number;
  item: Item;
  /** False once the bonus is at its cap from earlier groups. The match is real but adds
   * nothing, which is worth showing rather than hiding. */
  counted: boolean;
}

/**
 * Which bonus each group derives, capped per bonus.
 *
 * Filling every matching group would push a legal stable past `maxCopies` and raise a build
 * error, so the surplus is reported rather than filled. A pinned pick is skipped but still
 * consumes a copy against the groups after it.
 */
export function derivedBonuses(db: Db, build: Build): DerivedBonus[] {
  const used = new Map<string, number>();
  const derived: DerivedBonus[] = [];
  for (const state of readStable(db, build)) {
    const chosen = state.override ?? state.bonus;
    if (!chosen) continue;
    const max = db.maxCopies(chosen);
    const already = used.get(chosen.id) ?? 0;
    const counted = !max || already < max;
    if (counted) used.set(chosen.id, already + 1);
    if (!state.override)
      derived.push({ group: state.group, item: chosen, counted });
  }
  return derived;
}

/** `build` with every unpinned bonus slot filled from its group's insignia. Derived, never
 * stored, so the engine below sees an ordinary equipped item. */
export function withDerivedBonuses(db: Db, build: Build): Build {
  const derived = derivedBonuses(db, build).filter((entry) => entry.counted);
  if (!derived.length) return build;
  const choices = { ...build.choices };
  for (const entry of derived) {
    const slotId = bonusSlotId(db, entry.group);
    if (slotId) choices[slotId] = entry.item.id;
  }
  return { ...build, choices };
}
