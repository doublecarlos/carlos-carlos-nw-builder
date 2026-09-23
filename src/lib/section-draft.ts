// The draft <-> SlotSection conversion for SectionForm.vue (see bonus-draft.ts for the pattern).
//
// `slotIds` is not a draft field: the outline owns ordering, so the source's list is carried
// through as-is. `defaultOpen` is always written, since an absent value reads as open.
import { fieldDiffLabel, type DiffCheck } from "./draft-fields";
import type { SlotSection } from "../types";

export interface SectionDraft {
  label: string;
  defaultOpen: boolean;
}

export function buildDraft(
  section: SlotSection | null | undefined,
): SectionDraft {
  return {
    label: section?.label ?? "",
    defaultOpen: section?.defaultOpen !== false,
  };
}

/** Whether a brand-new section holds anything worth saving. */
export function hasContent(local: SectionDraft): boolean {
  return Boolean(local.label.trim());
}

/** The resolved id and the slot order to carry through, like `item-draft.ts`'s
 *  `ItemDraftContext`. */
export interface SectionDraftContext {
  id: string;
  slotIds: string[];
}

export function toSection(
  local: SectionDraft,
  ctx: SectionDraftContext,
): SlotSection {
  return {
    id: ctx.id,
    label: local.label.trim(),
    defaultOpen: local.defaultOpen,
    slotIds: [...ctx.slotIds],
  };
}

const CHECKS: DiffCheck<SlotSection>[] = [
  (old, nw) => (old.label !== nw.label ? `edit label to "${nw.label}"` : null),
  (old, nw) =>
    old.defaultOpen !== nw.defaultOpen
      ? nw.defaultOpen
        ? "expand by default"
        : "collapse by default"
      : null,
  (old, nw) =>
    JSON.stringify(old.slotIds) !== JSON.stringify(nw.slotIds)
      ? "reorder slots"
      : null,
];

export function diffLabel(oldJson: string, newJson: string): string {
  return fieldDiffLabel(CHECKS, oldJson, newJson, "edit section");
}
