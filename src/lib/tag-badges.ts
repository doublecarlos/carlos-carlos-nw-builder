// The badges an item card shows for an item's tags, from the tag declarations in
// data/vocabulary.json.
import { BADGE_TONES, type BadgeTone, type Item, type TagDef } from "../types";

const KNOWN = new Set<string>(BADGE_TONES);

export const isBadgeTone = (value: string): value is BadgeTone =>
  KNOWN.has(value);

export interface ItemBadge {
  tag: string;
  label: string;
  tone: string;
}

/** One badge per badged tag, in the item's tag order. The badge's own label wins, then the
 * tag's label, then the raw tag. */
export function itemBadges(item: Item, tags: readonly TagDef[]): ItemBadge[] {
  const byId = new Map(tags.map((tag) => [tag.id, tag]));
  return (item.tags ?? []).flatMap((tag) => {
    const def = byId.get(tag);
    if (!def?.badge) return [];
    return [
      {
        tag,
        label: def.badge.label || def.label || tag,
        tone: def.badge.tone,
      },
    ];
  });
}

/** The tone picker's choices, in palette order. */
export const TONE_OPTIONS: readonly { value: string; label: string }[] =
  BADGE_TONES.map((tone) => ({
    value: tone,
    label: tone[0].toUpperCase() + tone.slice(1),
  }));
