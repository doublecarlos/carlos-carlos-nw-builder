// Maps a demo's equipment bags (`Ebagid` + `Islotidx`) to this app's slot ids, and applies the
// one placement rule that covers every bag's awkward cases: for each demo item in a bag, in
// file order, resolve its `Hitem` through `Db.itemByGameId`, then take the first candidate app
// slot that's still empty and whose filter accepts the resolved item. No per-slot bookkeeping.
import gameImportJson from "../../data/game-import.json";
import type { Db, Slot } from "../types";
import type { DemoItem } from "./demo-snapshot";

export interface GameBagEntry {
  bag: string;
  /** Ordered candidate app slots, resolved by the placement rule below. */
  slots?: string[];
  /** `MountEquippedActiveSlots` only: `gemSlots[mountIndex][gemIndex]` -- the two-dimensional
   *  case the generic rule can't express (a mount at `Islotidx` n has up to 4 insignia). */
  gemSlots?: string[][];
  /** Present in the demo but deliberately unmodelled (cosmetics, movement speed, ...); the
   *  reason surfaces in the coverage report as "ignored on purpose" rather than "unrecognised". */
  notModelled?: string;
}

/** Authored explanation for a group of `notInDemo` slots (see `notInDemoGroups` below) -- either
 *  a handful of explicit slot ids (a partial section, e.g. only the non-class Options slots) or
 *  one or more whole `SlotSection` ids, resolved against the live slot list at read time so this
 *  table doesn't have to be kept in sync by hand when a section's slot count changes. */
export interface NotInDemoReasonEntry {
  label: string;
  reason: string;
  sections?: string[];
  slotIds?: string[];
}

export interface GameImportDataFile {
  bags: GameBagEntry[];
  /** Render order for the coverage report's "Not in the demo" group -- see `notInDemoGroups`. */
  notInDemoReasons: NotInDemoReasonEntry[];
}

export const GAME_IMPORT_DATA: GameImportDataFile =
  gameImportJson as GameImportDataFile;

const bagsByName = new Map(
  GAME_IMPORT_DATA.bags.map((entry) => [entry.bag, entry]),
);

export function bagEntry(bag: string): GameBagEntry | undefined {
  return bagsByName.get(bag);
}

// `Ppbuilds/Hclass` -> this app's `options.class` value. Per-character, not per-loadout --
// every loadout imported off one character gets the same class.
const HCLASS_TO_CLASS: Record<string, string> = {
  Player_Barbarian: "barbarian",
  Player_Bard: "bard",
  Player_Cleric: "cleric",
  Player_Fighter: "fighter",
  Player_Paladin: "paladin",
  Player_Ranger: "ranger",
  Player_Rogue: "rogue",
  Player_Scourge: "warlock",
  Player_Wizard: "wizard",
};

export function classFromHclass(hclass: string | null): string | null {
  if (!hclass) return null;
  return HCLASS_TO_CLASS[hclass] ?? null;
}

export type PlacementResult =
  /** Game item recognised and placed. */
  | { kind: "imported"; slotId: string; gameId: string; itemId: string }
  /** Game item present but no catalogue entry claims its `Hitem`. `slot` is the demo's own
   *  `Islotidx` (a mount's, for a gem) -- context for the coverage report, not an app slot. */
  | { kind: "unrecognised"; bag: string; slot: number; gameId: string }
  /** Bag is `notModelled` in game-import.json -- ignored on purpose. */
  | { kind: "ignored"; bag: string; gameId: string; reason: string }
  /** Recognised, but every candidate app slot for its bag was already full. */
  | { kind: "overflow"; bag: string; gameId: string; itemId: string };

/** Resolves one game id against `db`, and -- if a `slotId` candidate is given -- checks it's
 *  still empty and accepts the resolved item. Shared by both placement shapes below; `bag`/
 *  `slot` are only stamped onto the non-"imported" variants, matching `PlacementResult`. */
function resolveAt(
  gameId: string,
  slotId: string | undefined,
  db: Db,
  occupied: Set<string>,
  bag: string,
  slot: number,
): PlacementResult {
  const itemId = db.itemByGameId.get(gameId);
  if (!itemId) return { kind: "unrecognised", bag, slot, gameId };
  if (
    !slotId ||
    occupied.has(slotId) ||
    !db.forSlot(slotId).some((i) => i.id === itemId)
  ) {
    return { kind: "overflow", bag, gameId, itemId };
  }
  occupied.add(slotId);
  return { kind: "imported", slotId, gameId, itemId };
}

/**
 * Places every non-empty item of one bag into a concrete app slot, mutating `occupied` as it
 * goes so later items (this bag or a later one) see what's already taken. `items` must already
 * be in the order the placement rule should apply them in (file order, i.e. `Islotidx` order).
 */
export function placeBag(
  bag: string,
  items: DemoItem[],
  db: Db,
  occupied: Set<string>,
): PlacementResult[] {
  const entry = bagEntry(bag);

  // A bag the table doesn't know about at all (an unexpected client update) -- surface every
  // item as unrecognised rather than silently dropping it.
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
      item.gems.forEach((gameId, gemIndex) => {
        results.push(
          resolveAt(gameId, mountSlots[gemIndex], db, occupied, bag, item.slot),
        );
      });
    }
    return results;
  }

  const candidates = entry.slots ?? [];
  const results: PlacementResult[] = [];
  for (const item of items) {
    if (item.gameId == null) continue; // an empty demo slot is not a finding
    const itemId = db.itemByGameId.get(item.gameId);
    const slotId = itemId
      ? candidates.find(
          (id) =>
            !occupied.has(id) && db.forSlot(id).some((i) => i.id === itemId),
        )
      : undefined;
    results.push(resolveAt(item.gameId, slotId, db, occupied, bag, item.slot));
  }
  return results;
}

/** Every `item_picker` / `point_assignment` / `build_parameter` slot no bag entry names --
 *  what the coverage report renders as `notInDemo`. `options.class` is excluded even though no
 *  bag names it: it's importable from `Ppbuilds/Hclass`, just not through a bag at all. */
export function notInDemoSlotIds(slots: Slot[]): string[] {
  const named = new Set<string>(["options.class"]);
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
        !named.has(slot.id),
    )
    .map((slot) => slot.id);
}

// --- coverage report copy ---------------------------------------------------------------

export interface NotInDemoGroup {
  label: string;
  reason: string;
  slotIds: string[];
}

/** One known lossy mapping from the placement rule itself (#172), surfaced as a standing
 *  caveat rather than tied to any one outcome: mount combat power rarity is a silent
 *  narrowing of what an imported item actually is. */
export const KNOWN_LOSSY_NOTES = [
  "Mount combat power rarity (Celestial or not) isn't recorded — an imported mount combat power may not match the rarity you had equipped.",
];

/** Rolls a loadout's `notInDemo` slot ids up into `data/game-import.json`'s authored groups
 *  (only those with at least one id actually missing from this loadout), plus a catch-all per
 *  real section for any slot the table doesn't name yet -- so a future slot always shows up
 *  somewhere instead of silently vanishing from the report. */
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
      reason: "Not recorded in this demo — set it by hand.",
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
 * - a bag declares exactly one of `slots` / `gemSlots` / `notModelled`
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
    const shapes = [entry.slots, entry.gemSlots, entry.notModelled].filter(
      (shape) => shape !== undefined,
    );
    if (shapes.length !== 1) {
      findings.push({
        level: "error",
        context: entry.bag,
        message: `bag "${entry.bag}" must declare exactly one of slots / gemSlots / notModelled, found ${shapes.length}`,
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
