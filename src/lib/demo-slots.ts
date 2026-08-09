// Maps a demo's equipment bags (`Ebagid` + `Islotidx`) to this app's slot ids, and applies the
// one placement rule that covers every bag's awkward cases: for each demo item in a bag, in
// file order, resolve its `Hitem` through `Db.itemByGameId`, then take the first candidate app
// slot that's still empty and whose filter accepts the resolved item. No per-slot bookkeeping.
import gameBagsJson from "../../data/game-bags.json";
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

export interface GameBagsFile {
  bags: GameBagEntry[];
}

export const GAME_BAGS: GameBagsFile = gameBagsJson as GameBagsFile;

const bagsByName = new Map(GAME_BAGS.bags.map((entry) => [entry.bag, entry]));

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
  /** Bag is `notModelled` in game-bags.json -- ignored on purpose. */
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
  for (const entry of GAME_BAGS.bags) {
    for (const slotId of entry.slots ?? []) named.add(slotId);
    for (const group of entry.gemSlots ?? []) {
      for (const slotId of group) named.add(slotId);
    }
  }
  return slots
    .filter((slot) => slot.type !== "separator" && !named.has(slot.id))
    .map((slot) => slot.id);
}

// --- lint ------------------------------------------------------------------------------

export interface GameBagsLintFinding {
  level: "error" | "warn";
  message: string;
  bag?: string;
}

/**
 * - every slot id named in game-bags.json exists in `slots`
 * - no slot id is claimed by two bags
 * - a bag declares exactly one of `slots` / `gemSlots` / `notModelled`
 */
export function validateGameBags(
  bags: GameBagEntry[],
  slots: Slot[],
): GameBagsLintFinding[] {
  const findings: GameBagsLintFinding[] = [];
  const knownSlotIds = new Set(slots.map((slot) => slot.id));
  const owners = new Map<string, string>();

  const checkSlotId = (slotId: string, bag: string) => {
    if (!knownSlotIds.has(slotId)) {
      findings.push({
        level: "error",
        bag,
        message: `slot "${slotId}" does not exist in data/slots.json`,
      });
    }
    const owner = owners.get(slotId);
    if (owner && owner !== bag) {
      findings.push({
        level: "error",
        bag,
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
        bag: entry.bag,
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
