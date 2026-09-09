// Shared lifecycle behind the four editor forms (Item/Bonus/Preset/Slot), each hybrid in the
// same way: an existing entry live-edits (changes emit debounced), a brand-new one is a draft
// until Save. Owns the draft ref, `dirty`, `displayId`, the live-edit emit with its round-trip
// echo guard, and the `useDraftHistory` wiring. Each form supplies its own draft shape,
// entity conversion and diff labelling: the four drafts share this plumbing, not their shape.
import { ref, computed, watch, type ComputedRef, type Ref } from "vue";
import { useDraftHistory } from "./useDraftHistory";
import { deepEqual } from "../lib/deep-equal";

export interface UseEditorDraftOptions<Source, Draft, Entity> {
  /** The prop holding the entry being edited, or null/undefined for a brand-new one. */
  source: () => Source | null | undefined;
  /** True while there's no committed entry yet, per useDraftHistory's doc comment. Forms
   *  with an extra "already has a stable id" case (BonusForm's `fixedId`) fold it in here. */
  isNew: ComputedRef<boolean>;
  /** Builds a fresh draft from a source, or from null for a brand-new entry. */
  buildDraft: (source: Source | null | undefined) => Draft;
  /** Seeds the very first draft instead of `buildDraft(source())`: BonusForm's
   *  `initialDraft` prop, for the ItemBonuses embedded case. */
  initialDraft?: () => Draft | null | undefined;
  /** Converts a draft into its saved entity shape. May throw (e.g. a grant's JSON escape
   *  hatch); every call site is guarded, matching BonusForm's existing try/catch. */
  toEntity: (draft: Draft) => Entity;
  /** Names the first field that changed, for undo/redo labels and live-edit notices. */
  diffLabel: (oldJson: string, newJson: string) => string;
  /** Whether a brand-new draft has anything worth saving yet. */
  hasContent: (draft: Draft) => boolean;
  /** Extra gate on top of "changed since last emit": a half-drawn condition tree, an unmet
   *  required field, an unresolved path clash. Defaults to always allowed. */
  canEmit?: (draft: Draft) => boolean;
  /** Sends the live-edit update for an existing entry. */
  emit: (entity: Entity, label: string) => void;
  /** Resolves an id for display before the entity has one of its own: the `catalog.nextId`
   *  variants differ per entity type, so both halves are supplied per form. */
  displayId: {
    sourceId: () => string | undefined;
    computeId: (draft: Draft) => string;
  };
  /** Extra per-form state to resync when the draft rebuilds from a new source, e.g.
   *  ItemForm's `descriptionActive`/`repetitionActive`. */
  onRebuild?: (draft: Draft) => void;
}

export function useEditorDraft<Source, Draft, Entity>(
  options: UseEditorDraftOptions<Source, Draft, Entity>,
) {
  const {
    source,
    isNew,
    buildDraft,
    initialDraft,
    toEntity,
    diffLabel,
    hasContent,
    canEmit,
    emit: emitEntity,
    displayId: displayIdOptions,
    onRebuild,
  } = options;

  const error = ref("");
  const draft = ref(initialDraft?.() ?? buildDraft(source())) as Ref<Draft>;

  function safeToEntity(): Entity | null {
    try {
      return toEntity(draft.value);
    } catch {
      return null;
    }
  }

  let lastEmittedJson = JSON.stringify(safeToEntity() ?? draft.value);

  function emitChange() {
    if (canEmit && !canEmit(draft.value)) return;
    const entity = safeToEntity();
    if (!entity) return;
    const currentJson = JSON.stringify(entity);
    if (currentJson === lastEmittedJson) return;
    const label = diffLabel(lastEmittedJson, currentJson);
    lastEmittedJson = currentJson;
    emitEntity(entity, label);
  }

  const draftHistory = useDraftHistory({
    draft,
    isNew,
    diffLabel,
    onEmit: emitChange,
  });

  // Branches on the source itself, not `isNew`. BonusForm's `isNew` also folds in `fixedId`
  // (a pending slot that live-edits without a saved source yet), but dirty still wants the
  // plain "has this diverged from what's saved" question either way.
  const dirty = computed(() => {
    if (!source()) return hasContent(draft.value);
    const entity = safeToEntity();
    return !entity || !deepEqual(entity, source());
  });

  const displayId = computed(
    () =>
      displayIdOptions.sourceId() ?? displayIdOptions.computeId(draft.value),
  );

  // Rebuild the draft when source changes (e.g. after undo/redo reverts the overlay). A live
  // edit's own update emit round-trips through the layer overlay back into this prop, and
  // rebuilding from that echo would wipe a half-drawn row, since every `toEntity` drops
  // whatever isn't filled in yet. Skip the rebuild when the incoming source is byte-identical
  // to what this form last emitted.
  watch(source, (value) => {
    if (value && lastEmittedJson && JSON.stringify(value) === lastEmittedJson)
      return;
    draft.value = buildDraft(value);
    onRebuild?.(draft.value);
    error.value = "";
    lastEmittedJson = JSON.stringify(safeToEntity() ?? draft.value);
    draftHistory.resetDraftHistory();
  });

  return {
    draft,
    error,
    dirty,
    displayId,
    emitChange,
    ...draftHistory,
  };
}
