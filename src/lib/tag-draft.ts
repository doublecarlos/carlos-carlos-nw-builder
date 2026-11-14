// The draft <-> TagDef conversion for TagForm.vue (see filter-draft.ts for the pattern).
import { putIfSet, fieldDiffLabel, type DiffCheck } from "./draft-fields";
import type { TagBadge, TagDef } from "../types";

export interface TagDraft {
  /** The tag a new declaration names, typed as-is. Empty for an existing entry. */
  name: string;
  /** How the tag reads to a person; empty shows the raw tag. */
  label: string;
  /** The badge's tone; empty means no badge. */
  badgeTone: string;
  /** The badge's own text; empty reads the tag's label. */
  badgeLabel: string;
}

export function buildDraft(tag: TagDef | null | undefined): TagDraft {
  return {
    name: "",
    label: tag?.label ?? "",
    badgeTone: tag?.badge?.tone ?? "",
    badgeLabel: tag?.badge?.label ?? "",
  };
}

/** Whether a brand-new declaration holds anything worth saving. */
export function hasContent(local: TagDraft): boolean {
  return Boolean(local.name.trim() || local.label.trim() || local.badgeTone);
}

/** A typed tag as stored: trimmed, inner spacing kept, since tags are matched exactly. */
export const tagIdOf = (name: string) => name.trim();

/** The resolved tag id, like `filter-draft.ts`'s `FilterDraftContext`. */
export interface TagDraftContext {
  id: string;
}

export function toTag(local: TagDraft, ctx: TagDraftContext): TagDef {
  const tag: TagDef = { id: ctx.id };
  putIfSet(tag, "label", local.label.trim() || undefined);
  // A badge label is only kept with a tone, since without one there is no badge to show it.
  if (local.badgeTone) {
    const badge: TagBadge = { tone: local.badgeTone };
    putIfSet(badge, "label", local.badgeLabel.trim() || undefined);
    tag.badge = badge;
  }
  return tag;
}

const CHECKS: DiffCheck<TagDef>[] = [
  (old, nw) =>
    old.label !== nw.label ? `edit label → ${nw.label ?? "(none)"}` : null,
  (old, nw) =>
    JSON.stringify(old.badge) !== JSON.stringify(nw.badge)
      ? `edit badge → ${nw.badge ? `${nw.badge.label ?? "(tag label)"} (${nw.badge.tone})` : "(none)"}`
      : null,
];

export function diffLabel(oldJson: string, newJson: string): string {
  return fieldDiffLabel(CHECKS, oldJson, newJson, "edit tag");
}
