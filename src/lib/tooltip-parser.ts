// Parses a Neverwinter item tooltip's text into an item draft carrying only its *base* stats.
//
// Bonuses and conditions are deliberately not attempted: the tooltip text describing them is
// prose, and reproducing a condition tree from it is not something this parser tries to do.
// Lines that clearly carry a bonus, and lines carrying a number we could not place, are
// reported rather than dropped -- an unparsed line is information the reviewer needs.
//
// Every rule here exists because omitting it produced a wrong draft; see the notes on each.

import { NW_SCHEMA } from "../data/data";
import type { Item, StatKey } from "../types";

/** A stat line the parser placed onto the draft. */
export interface ParsedStat {
  key: StatKey;
  value: number;
  /** The source line, so a reviewer can see where a value came from. */
  line: string;
}

export interface TooltipParseResult {
  /** Item-shaped draft: `name`/`il` plus one entry per recognised stat line. */
  draft: Partial<Item>;
  stats: ParsedStat[];
  /** Lines granting a stat through an enchantment or armour kit rather than the item itself. */
  bonusLines: string[];
  /** Lines that carry a number but matched no stat -- set bonuses, procs, flavour text. */
  unmatched: string[];
}

/** Slot labels that prefix an otherwise ordinary stat line: "Offense: +2,700 Combat Advantage". */
const SLOT_PREFIX = /^(offense|defense|utility|insignia slot)\s*[:.]\s*/i;

/** Prefixes marking a stat that comes from an enchantment or kit, not the item's own base. */
const BONUS_PREFIX = /^(equip|reinforced|use|set|modification)\s*[:.]\s*/i;

/** "Item Level: 5,250" is `key: value`, unlike every other stat line. */
const ITEM_LEVEL = /^item\s*level\s*[:.]?\s*([\d,]+)\s*$/i;

/** "+2,700 Combat Advantage" / "+1.5% Recharge Speed" / "3,412 Accuracy". */
const STAT_LINE =
  /^\+?\s*([\d,]+(?:\.\d+)?)\s*(%?)\s*([A-Za-z][A-Za-z './]*?)\.?$/;

/** Chrome the game prints above the item name. */
const CHROME =
  /^(equipped|bound|binds on|double-click|cannot |requires |minimum level|no level)/i;

const stripCommas = (s: string): number => Number(s.replace(/,/g, ""));

/**
 * Tooltip label (or abbreviation, or alias) to the catalog keys sharing it. Most labels map to
 * two keys -- a percent form and a rating form, e.g. "Power" is both `power_p` and `power` --
 * which the `%` sign in the line disambiguates.
 *
 * `aliases` in `data/schema.json` carries the names the game prints that differ from a stat's
 * own label ("Action Point Gain" for `AP Gain`). A stat that has both a percent and a rating
 * form declares the alias on each, exactly as it already does for `label` and `abbr`.
 */
const buildIndex = (): Map<string, { percent?: StatKey; plain?: StatKey }> => {
  const index = new Map<string, { percent?: StatKey; plain?: StatKey }>();
  const add = (name: string, key: StatKey, isPercent: boolean) => {
    const slot = index.get(name.toLowerCase()) ?? {};
    if (isPercent) slot.percent ??= key;
    else slot.plain ??= key;
    index.set(name.toLowerCase(), slot);
  };

  for (const stat of NW_SCHEMA.stats) {
    const isPercent = stat.kind === "percent" || stat.kind === "mult";
    add(stat.label, stat.key, isPercent);
    if ("abbr" in stat && stat.abbr) add(stat.abbr, stat.key, isPercent);
    if ("aliases" in stat && stat.aliases) {
      for (const alias of stat.aliases) add(alias, stat.key, isPercent);
    }
  }
  return index;
};

let cached: Map<string, { percent?: StatKey; plain?: StatKey }> | null = null;
const statIndex = () => (cached ??= buildIndex());

export function parseTooltip(text: string): TooltipParseResult {
  const stats: ParsedStat[] = [];
  const bonusLines: string[] = [];
  const unmatched: string[] = [];
  const draft: Partial<Item> = {};
  const seen = new Set<StatKey>();
  const index = statIndex();

  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line) continue;

    const itemLevel = line.match(ITEM_LEVEL);
    if (itemLevel) {
      if (!seen.has("il")) {
        seen.add("il");
        stats.push({ key: "il", value: stripCommas(itemLevel[1]), line });
      }
      continue;
    }

    // A stat granted by an enchantment or kit is not part of the item's base stats. Recorded
    // rather than dropped so the reviewer knows the tooltip carried more than was applied.
    if (BONUS_PREFIX.test(line)) {
      if (/\d/.test(line)) bonusLines.push(line);
      continue;
    }

    const body = line.replace(SLOT_PREFIX, "");
    const match = body.match(STAT_LINE);
    if (!match) {
      if (/\d/.test(line) && !CHROME.test(line)) unmatched.push(line);
      continue;
    }

    const [, digits, percentSign, label] = match;
    const entry = index.get(label.trim().toLowerCase());
    const key = entry && (percentSign ? entry.percent : entry.plain);
    if (!key) {
      unmatched.push(line);
      continue;
    }

    // Base stats are printed before any bonus lines, so the first value for a key is the
    // item's own. Without this a later "Equip: +880 Combat Advantage" overwrites the base
    // "+849 Combat Advantage" -- the one way this parser can produce a silently wrong item.
    if (seen.has(key)) continue;
    seen.add(key);
    stats.push({
      key,
      value: percentSign ? stripCommas(digits) / 100 : stripCommas(digits),
      line,
    });
  }

  for (const { key, value } of stats) draft[key] = value;

  const name = findName(text);
  if (name) draft.name = name;

  return { draft, stats, bonusLines, unmatched };
}

/**
 * Chrome, matched anywhere in the line rather than at its start: OCR routinely prefixes the
 * first lines with a stray glyph read off the item's icon ("Ax EQUIPPED"), so anchoring here
 * would let that through as the item name.
 */
const CHROME_ANYWHERE =
  /(equipped|bound|binds on|double-click|unequip|cannot |requires |minimum level|no level|maximum quality)/i;

/**
 * The item name is the first line that is neither game chrome nor a stat. Purely a
 * convenience -- a wrong guess here is obvious to the reviewer, unlike a wrong number.
 */
function findName(text: string): string | undefined {
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    // Two letters or fewer is never a name, and is what icon noise usually reads as.
    if (line.length < 3 || !/[A-Za-z]{3}/.test(line)) continue;
    if (CHROME_ANYWHERE.test(line) || ITEM_LEVEL.test(line)) continue;
    if (STAT_LINE.test(line.replace(SLOT_PREFIX, ""))) continue;
    if (/^[-=#]{2,}/.test(line)) continue;
    return line;
  }
  return undefined;
}
