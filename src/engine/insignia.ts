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

const stableGroups = (db: Db) => stableIndex(db).groups;

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

/** One slot's rule in words, for a row that has to say what it takes while empty. */
export function describeSlotSpec(spec: InsigniaSlotSpec): string {
  if (!spec.universal) return String(spec.shape);
  return spec.preferred ? `universal, prefers ${spec.preferred}` : "universal";
}

/** A whole mount's slots in one line. */
export const slotLine = (mount: Item) =>
  (mount.insigniaSlots ?? []).map(describeSlotSpec).join(" · ");

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
            // Only shapes the catalogue supplies, or `planFor` fails on a workable pairing.
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

export const allMounts = (db: Db) => db.items.filter((i) => i.insigniaSlots);
export const allBonuses = (db: Db) => db.items.filter((i) => i.insigniaRecipe);

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

/**
 * Insignia ids producing `bonus` on `mount`, or null. An empty string leaves that slot empty.
 *
 * Fills ordinary insignia, not `(Pref)`: the editor's normalisation upgrades the ones whose
 * slots earn it, so both paths end in the same state.
 */
export function planFor(db: Db, mount: Item, bonus: Item): string[] | null {
  const best = bestArrangement(db, mount, bonus);
  if (!best) return null;
  const ids = best.shapes.map((shape) =>
    shape ? (insigniaOfShape(db, shape)?.id ?? "") : "",
  );
  return best.shapes.every((shape, i) => !shape || ids[i]) ? ids : null;
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

// --- preferred variants -----------------------------------------------------------------------

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

/** Slots whose pick disagrees with whether that slot is preferred, and what belongs there. */
export function normaliseGroup(
  db: Db,
  build: Build,
  group: number,
): Record<string, string> {
  const state = readGroup(db, build, group);
  const slotIds = insigniaSlotIds(db, group);
  const changes: Record<string, string> = {};
  state.insignia.forEach((item, i) => {
    if (!item) return;
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
