// Display info for item qualities. Colors live in base.css as `--quality-<id>`, one value per
// theme, so this table only names them.
import { ITEM_QUALITIES, type ItemQuality } from "../types";

export interface QualityInfo {
  id: ItemQuality;
  label: string;
}

const LABELS: Record<ItemQuality, string> = {
  common: "Common",
  uncommon: "Uncommon",
  rare: "Rare",
  epic: "Epic",
  legendary: "Legendary",
  mythic: "Mythic",
  celestial: "Celestial",
};

/** Every quality, lowest rank first. */
export const QUALITIES: readonly QualityInfo[] = ITEM_QUALITIES.map((id) => ({
  id,
  label: LABELS[id],
}));

/** No quality: absent on an item, empty in a draft. */
type MaybeQuality = string | null | undefined;

const KNOWN = new Set<string>(ITEM_QUALITIES);

export const isQuality = (value: string): value is ItemQuality =>
  KNOWN.has(value);

/** The quality's theme color as a CSS value, or undefined for an item with none. */
export const qualityColor = (quality: MaybeQuality): string | undefined =>
  quality ? `var(--quality-${quality})` : undefined;

/** Sets `--tone` for markup that reads it through `text-(--tone)`. No quality resets it to
 * `currentColor`, so a plain row never picks up a tone set further out, such as a card's. */
export const toneStyle = (quality: MaybeQuality): Record<string, string> => ({
  "--tone": qualityColor(quality) ?? "currentColor",
});
