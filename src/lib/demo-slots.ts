// Maps a demo's equipment bags (`Ebagid` + `Islotidx`) to this app's slot ids.
//
// A bag is seated as a whole, never item by item in slot order: the demo records `Islotidx`
// against the layout the game showed that character's class, and those layouts differ per class.
// Any complete seating is equivalent, since nothing the engine evaluates can see slot ids.
import gameImportJson from "../../data/game-import.json";
import type { Db, Item, Slot } from "../types";
import type { DemoItem } from "./demo-snapshot";

export interface GameBagEntry {
  bag: string;
  /** Candidate app slots. Order picks between equally valid seatings, never whether one exists. */
  slots?: string[];
  /** `MountEquippedActiveSlots` only. Pairs with `slots`, which then takes this bag's own items
   *  positionally: the mount at `Islotidx` n is `slots[n]`, its insignia `gemSlots[n]`. */
  gemSlots?: string[][];
  /** Present in the demo but deliberately unmodelled; reported as ignored, not unrecognised. */
  notModelled?: string;
}

/** Explanation for a group of `notInDemo` slots, named by slot id or by whole section. Sections
 *  resolve against the live slot list, so a section's slot count can change without an edit. */
export interface NotInDemoReasonEntry {
  label: string;
  reason: string;
  sections?: string[];
  slotIds?: string[];
}

export interface GameImportDataFile {
  bags: GameBagEntry[];
  /** Render order for the coverage report's "Not in the demo" group. */
  notInDemoReasons: NotInDemoReasonEntry[];
  /** `Ppbuilds/Hclass` -> `options.class` value. Per-character, so every loadout shares it. */
  hclassToClass: Record<string, string>;
  /** `Species` with its gender suffix stripped -> the `raceLeveling.race` item id. Only tokens
   *  confirmed against a real recording belong here; a guessed one equips the wrong race. */
  speciesToRace: Record<string, string>;
  /** Slot id -> item id an imported build falls back to. Applied once every bag is placed and
   *  only where the slot is still empty, so a recognised game item always wins. */
  defaultChoices: Record<string, string>;
}

export const GAME_IMPORT_DATA: GameImportDataFile =
  gameImportJson as GameImportDataFile;

const bagsByName = new Map(
  GAME_IMPORT_DATA.bags.map((entry) => [entry.bag, entry]),
);

export function bagEntry(bag: string): GameBagEntry | undefined {
  return bagsByName.get(bag);
}

/** Candidate app slot ids behind one `unrecognised` outcome, for the report's "map to an item"
 *  picker. `slot` is the outcome's `Islotidx`, only meaningful as a mount index for a gem bag. */
export function candidateSlotIds(bag: string, slot: number): string[] {
  const entry = bagEntry(bag);
  if (!entry) return [];
  // A gem bag holds a mount and its insignia at one index, and the outcome records only that
  // index, so both are offered.
  if (entry.gemSlots) {
    const mount = entry.slots?.[slot];
    return [...(mount ? [mount] : []), ...(entry.gemSlots[slot] ?? [])];
  }
  if (entry.slots) return entry.slots;
  return [];
}

export function classFromHclass(hclass: string | null): string | null {
  if (!hclass) return null;
  return GAME_IMPORT_DATA.hclassToClass[hclass] ?? null;
}

export function raceFromSpecies(species: string | null): string | null {
  if (!species) return null;
  const race = species.replace(/_(Male|Female)$/, "");
  return GAME_IMPORT_DATA.speciesToRace[race] ?? null;
}

export type PlacementResult =
  | { kind: "imported"; slotId: string; gameId: string; itemId: string }
  /** `slot` is the demo's own `Islotidx` (a mount's, for a gem), never an app slot. */
  | { kind: "unrecognised"; bag: string; slot: number; gameId: string }
  | { kind: "ignored"; bag: string; gameId: string; reason: string }
  /** Recognised, but no candidate slot was free. */
  | { kind: "overflow"; bag: string; gameId: string; itemId: string };

/** Every candidate slot accepting `gameId`, in candidate order, paired with the catalogue entry
 *  that slot resolves it to. One game id can have several claimants (an enchantment's offense
 *  and defense forms); the accepting slot is what picks between them. */
function optionsFor(
  gameId: string,
  candidates: readonly string[],
  db: Db,
  acceptedBy: Map<string, Item[]> = new Map(),
): { slotId: string; itemId: string }[] {
  const claimants = db.itemByGameId.get(gameId) ?? [];
  const options: { slotId: string; itemId: string }[] = [];
  for (const slotId of candidates) {
    let accepted = acceptedBy.get(slotId);
    if (!accepted) {
      accepted = db.forSlot(slotId);
      acceptedBy.set(slotId, accepted);
    }
    const itemId = claimants.find((id) => accepted.some((i) => i.id === id));
    if (itemId) options.push({ slotId, itemId });
  }
  return options;
}

/** First-free placement, for the single-candidate shape: a mount and each of its insignia have
 *  exactly one possible home, so there is nothing for the matching below to choose between. */
function resolveAt(
  gameId: string,
  candidates: readonly string[],
  db: Db,
  occupied: Set<string>,
  bag: string,
  slot: number,
): PlacementResult {
  const claimants = db.itemByGameId.get(gameId) ?? [];
  if (!claimants.length) return { kind: "unrecognised", bag, slot, gameId };

  const options = optionsFor(gameId, candidates, db);
  for (const { slotId, itemId } of options) {
    if (occupied.has(slotId)) continue;
    occupied.add(slotId);
    return { kind: "imported", slotId, gameId, itemId };
  }
  // Report the entry this bag would have used, not whichever claimant is listed first.
  return {
    kind: "overflow",
    bag,
    gameId,
    itemId: options[0]?.itemId ?? claimants[0],
  };
}

interface Pending {
  resultIndex: number;
  gameId: string;
  options: { slotId: string; itemId: string }[];
  /** Reported when the matching leaves this item unseated. */
  fallbackItemId: string;
}

/**
 * Maximum bipartite matching (Kuhn's augmenting paths) between a bag's recognised items and the
 * candidate slots `occupied` leaves free. Each item is first offered a free slot in candidate
 * order, so a bag plain first-fit could already seat is seated identically; only a blocked item
 * displaces a seated one onto another of its own options.
 */
function placeByMatching(
  bag: string,
  items: DemoItem[],
  candidates: readonly string[],
  db: Db,
  occupied: Set<string>,
): PlacementResult[] {
  const acceptedBy = new Map<string, Item[]>();
  const results: PlacementResult[] = [];
  const pending: Pending[] = [];

  for (const item of items) {
    if (item.gameId == null) continue; // an empty demo slot is not a finding
    const gameId = item.gameId;
    const claimants = db.itemByGameId.get(gameId) ?? [];
    if (!claimants.length) {
      results.push({ kind: "unrecognised", bag, slot: item.slot, gameId });
      continue;
    }
    const options = optionsFor(gameId, candidates, db, acceptedBy);
    pending.push({
      resultIndex: results.length,
      gameId,
      options,
      fallbackItemId: options[0]?.itemId ?? claimants[0],
    });
    // Placeholder holding this item's position; every one is overwritten below.
    results.push({ kind: "overflow", bag, gameId, itemId: claimants[0] });
  }

  const seatedBy = new Map<string, number>();
  const seat = (index: number, seen: Set<string>): boolean => {
    const { options } = pending[index];
    for (const { slotId } of options) {
      if (occupied.has(slotId) || seen.has(slotId) || seatedBy.has(slotId))
        continue;
      seen.add(slotId);
      seatedBy.set(slotId, index);
      return true;
    }
    for (const { slotId } of options) {
      if (occupied.has(slotId) || seen.has(slotId)) continue;
      seen.add(slotId);
      if (seat(seatedBy.get(slotId)!, seen)) {
        seatedBy.set(slotId, index);
        return true;
      }
    }
    return false;
  };
  pending.forEach((_, index) => seat(index, new Set()));

  const slotOf = new Map<number, string>();
  for (const [slotId, index] of seatedBy) {
    slotOf.set(index, slotId);
    occupied.add(slotId);
  }

  pending.forEach((entry, index) => {
    const slotId = slotOf.get(index);
    const seated = entry.options.find((option) => option.slotId === slotId);
    results[entry.resultIndex] = seated
      ? { kind: "imported", ...seated, gameId: entry.gameId }
      : {
          kind: "overflow",
          bag,
          gameId: entry.gameId,
          itemId: entry.fallbackItemId,
        };
  });

  return results;
}

/** Places one bag's non-empty items, adding each seated slot to `occupied` for later bags. One
 *  result per non-empty item, in `items` order, which the coverage report indexes into. */
export function placeBag(
  bag: string,
  items: DemoItem[],
  db: Db,
  occupied: Set<string>,
): PlacementResult[] {
  const entry = bagEntry(bag);

  // An unknown bag (a client update): surface its items rather than dropping them.
  if (!entry) {
    return items
      .filter(
        (item): item is DemoItem & { gameId: string } => item.gameId != null,
      )
      .map((item) => ({
        kind: "unrecognised",
        bag,
        slot: item.slot,
        gameId: item.gameId,
      }));
  }

  if (entry.notModelled) {
    const reason = entry.notModelled;
    return items
      .filter(
        (item): item is DemoItem & { gameId: string } => item.gameId != null,
      )
      .map((item) => ({ kind: "ignored", bag, gameId: item.gameId, reason }));
  }

  if (entry.gemSlots) {
    const results: PlacementResult[] = [];
    for (const item of items) {
      const mountSlots = entry.gemSlots[item.slot];
      if (!mountSlots) continue; // more equipped mounts than we have insignia groups for
      // The bag's own item is the mount holding these gems, placed at the same index.
      const mountSlot = entry.slots?.[item.slot];
      if (mountSlot && item.gameId != null) {
        results.push(
          resolveAt(item.gameId, [mountSlot], db, occupied, bag, item.slot),
        );
      }
      item.gems.forEach((gameId, gemIndex) => {
        const target = mountSlots[gemIndex];
        results.push(
          resolveAt(
            gameId,
            target ? [target] : [],
            db,
            occupied,
            bag,
            item.slot,
          ),
        );
      });
    }
    return results;
  }

  return placeByMatching(bag, items, entry.slots ?? [], db, occupied);
}

/** Every value-holding slot no bag entry names, which the report renders as `notInDemo`.
 *  `options.class` and `raceLeveling.race` are excluded because they import from the character
 *  rather than a bag, a stable bonus row because it derives from the insignia. */
export function notInDemoSlotIds(slots: Slot[]): string[] {
  const named = new Set<string>(["options.class", "raceLeveling.race"]);
  for (const entry of GAME_IMPORT_DATA.bags) {
    for (const slotId of entry.slots ?? []) named.add(slotId);
    for (const group of entry.gemSlots ?? []) {
      for (const slotId of group) named.add(slotId);
    }
  }
  return slots
    .filter(
      (slot) =>
        slot.type !== "separator" &&
        slot.type !== "text" &&
        !named.has(slot.id) &&
        !(slot.type === "item_picker" && slot.stable?.role === "bonus"),
    )
    .map((slot) => slot.id);
}

// --- coverage report copy ---------------------------------------------------------------

export interface NotInDemoGroup {
  label: string;
  reason: string;
  slotIds: string[];
}

/** Standing caveats about what an import narrows, shown whatever the outcomes were. */
export const KNOWN_LOSSY_NOTES = [
  "Mount combat power rarity (Celestial or not) isn't recorded - an imported mount combat power may not match the rarity you had equipped.",
  "A mount combat power the catalogue doesn't model yet stays on the generic one.",
];

/** Rolls `notInDemo` slot ids up into the authored groups, plus a catch-all per section for any
 *  slot the table does not name, so a new slot cannot vanish from the report. */
export function notInDemoGroups(db: Db, slotIds: string[]): NotInDemoGroup[] {
  const present = new Set(slotIds);
  const bySection = new Map<string, string[]>();
  for (const slot of db.slots) {
    if (slot.type === "separator" || slot.type === "text") continue;
    const list = bySection.get(slot.section);
    if (list) list.push(slot.id);
    else bySection.set(slot.section, [slot.id]);
  }

  const covered = new Set<string>();
  const groups: NotInDemoGroup[] = [];
  for (const authored of GAME_IMPORT_DATA.notInDemoReasons) {
    const candidates =
      authored.slotIds ??
      (authored.sections ?? []).flatMap((s) => bySection.get(s) ?? []);
    const ids = candidates.filter((id) => present.has(id));
    if (!ids.length) continue;
    for (const id of ids) covered.add(id);
    groups.push({
      label: authored.label,
      reason: authored.reason,
      slotIds: ids,
    });
  }

  const sectionLabel = new Map(db.sections.map((s) => [s.id, s.label]));
  for (const [sectionId, ids] of bySection) {
    const leftover = ids.filter((id) => present.has(id) && !covered.has(id));
    if (!leftover.length) continue;
    groups.push({
      label: sectionLabel.get(sectionId) ?? sectionId,
      reason: "Not recorded in this demo - set it by hand.",
      slotIds: leftover,
    });
  }

  return groups;
}

// --- lint ------------------------------------------------------------------------------

export interface GameImportLintFinding {
  level: "error" | "warn";
  message: string;
  /** The bag name or `notInDemoReasons` label the finding is about. */
  context?: string;
}

/**
 * - every slot id named in game-import.json exists in `slots`
 * - no slot id is claimed by two bags
 * - a bag declares `notModelled`, or at least one of `slots` / `gemSlots`, never both
 */
export function validateGameBags(
  bags: GameBagEntry[],
  slots: Slot[],
): GameImportLintFinding[] {
  const findings: GameImportLintFinding[] = [];
  const knownSlotIds = new Set(slots.map((slot) => slot.id));
  const owners = new Map<string, string>();

  const checkSlotId = (slotId: string, bag: string) => {
    if (!knownSlotIds.has(slotId)) {
      findings.push({
        level: "error",
        context: bag,
        message: `slot "${slotId}" does not exist in data/slots.json`,
      });
    }
    const owner = owners.get(slotId);
    if (owner && owner !== bag) {
      findings.push({
        level: "error",
        context: bag,
        message: `slot "${slotId}" is claimed by both "${owner}" and "${bag}"`,
      });
    } else {
      owners.set(slotId, bag);
    }
  };

  for (const entry of bags) {
    // `slots` and `gemSlots` pair up; `notModelled` answers for the whole bag and pairs with
    // neither.
    const placed = entry.slots !== undefined || entry.gemSlots !== undefined;
    const notModelled = entry.notModelled !== undefined;
    if (placed === notModelled) {
      findings.push({
        level: "error",
        context: entry.bag,
        message: `bag "${entry.bag}" must declare either notModelled or at least one of slots / gemSlots, not both`,
      });
    }
    for (const slotId of entry.slots ?? []) checkSlotId(slotId, entry.bag);
    for (const group of entry.gemSlots ?? []) {
      for (const slotId of group) checkSlotId(slotId, entry.bag);
    }
  }

  return findings;
}

/**
 * - `slotId` names an `item_picker` slot that exists
 * - every value is one of that slot's own candidate item ids, so a typo cannot produce a
 *   choice that resolves to nothing
 */
export function validateItemValueMap(
  map: Record<string, string>,
  slotId: string,
  db: Db,
  context: string,
): GameImportLintFinding[] {
  const slot = db.slotById.get(slotId);
  if (!slot || slot.type !== "item_picker") {
    return [
      {
        level: "error",
        context,
        message: `slot "${slotId}" does not exist as an item_picker in data/slots.json`,
      },
    ];
  }

  const knownIds = new Set(db.forSlot(slotId).map((item) => item.id));
  const findings: GameImportLintFinding[] = [];
  for (const [key, value] of Object.entries(map)) {
    if (!knownIds.has(value)) {
      findings.push({
        level: "error",
        context,
        message: `"${key}" maps to "${value}", not one of "${slotId}"'s own item ids`,
      });
    }
  }
  return findings;
}

/** Every value the map targets is one some item publishes at `path` (`Item.publishes`), which
 *  is where this vocabulary lives: a typo would otherwise resolve to nothing at all. */
export function validateValueMap(
  map: Record<string, string>,
  path: string,
  items: Item[],
  context: string,
): GameImportLintFinding[] {
  const knownValues = new Set(
    items
      .map((item) => item.publishes?.[path])
      .filter((value): value is string => typeof value === "string" && !!value),
  );
  if (!knownValues.size) {
    return [
      {
        level: "error",
        context,
        message: `no item publishes "${path}" - nothing in this map could ever resolve`,
      },
    ];
  }

  const findings: GameImportLintFinding[] = [];
  for (const [key, value] of Object.entries(map)) {
    if (!knownValues.has(value)) {
      findings.push({
        level: "error",
        context,
        message: `"${key}" maps to "${value}", which no item publishes at "${path}"`,
      });
    }
  }
  return findings;
}

/**
 * - every `notInDemoReasons` entry declares at least one of `sections` / `slotIds`
 * - every section id it names exists in `sections`
 * - every literal slot id it names exists in `slots`
 */
export function validateNotInDemoReasons(
  reasons: NotInDemoReasonEntry[],
  slots: Slot[],
  sections: { id: string }[],
): GameImportLintFinding[] {
  const findings: GameImportLintFinding[] = [];
  const knownSlotIds = new Set(slots.map((slot) => slot.id));
  const knownSectionIds = new Set(sections.map((section) => section.id));

  for (const entry of reasons) {
    if (!entry.sections?.length && !entry.slotIds?.length) {
      findings.push({
        level: "error",
        context: entry.label,
        message: `"${entry.label}" must declare at least one of sections / slotIds`,
      });
    }
    for (const sectionId of entry.sections ?? []) {
      if (!knownSectionIds.has(sectionId)) {
        findings.push({
          level: "error",
          context: entry.label,
          message: `section "${sectionId}" does not exist in data/slots.json`,
        });
      }
    }
    for (const slotId of entry.slotIds ?? []) {
      if (!knownSlotIds.has(slotId)) {
        findings.push({
          level: "error",
          context: entry.label,
          message: `slot "${slotId}" does not exist in data/slots.json`,
        });
      }
    }
  }

  return findings;
}

/**
 * - every key names an `item_picker` slot that exists
 * - every value is one of that slot's own candidate item ids
 */
export function validateDefaultChoices(
  map: Record<string, string>,
  db: Db,
  context: string,
): GameImportLintFinding[] {
  const findings: GameImportLintFinding[] = [];
  for (const [slotId, itemId] of Object.entries(map)) {
    const slot = db.slotById.get(slotId);
    if (!slot || slot.type !== "item_picker") {
      findings.push({
        level: "error",
        context,
        message: `slot "${slotId}" does not exist as an item_picker in data/slots.json`,
      });
      continue;
    }
    if (!db.forSlot(slotId).some((item) => item.id === itemId)) {
      findings.push({
        level: "error",
        context,
        message: `"${slotId}" defaults to "${itemId}", not one of its own candidate item ids`,
      });
    }
  }
  return findings;
}
