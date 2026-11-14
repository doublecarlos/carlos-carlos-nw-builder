// The draft <-> TagDef conversion for TagForm.vue (see filter-draft.ts for the pattern).
import { putIfSet, fieldDiffLabel, type DiffCheck } from "./draft-fields";
import type { TagDef } from "../types";

export interface TagDraft {
  /** The tag a new declaration names, typed as-is. Empty for an existing entry. */
  name: string;
  /** How the tag reads to a person; empty shows the raw tag. */
  label: string;
}

export function buildDraft(tag: TagDef | null | undefined): TagDraft {
  return { name: "", label: tag?.label ?? "" };
}

/** Whether a brand-new declaration holds anything worth saving. */
export function hasContent(local: TagDraft): boolean {
  return Boolean(local.name.trim() || local.label.trim());
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
  return tag;
}

const CHECKS: DiffCheck<TagDef>[] = [
  (old, nw) =>
    old.label !== nw.label ? `edit label → ${nw.label ?? "(none)"}` : null,
];

export function diffLabel(oldJson: string, newJson: string): string {
  return fieldDiffLabel(CHECKS, oldJson, newJson, "edit tag");
}
