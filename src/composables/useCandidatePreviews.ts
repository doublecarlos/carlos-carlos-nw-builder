// A picker's candidate previews, resolved on demand: only the rows it renders, the card it
// shows and the candidates that could be withheld ever pay for a resolve.
import { computed, type ComputedRef } from "vue";
import {
  candidatePreview,
  type CandidatePreview,
  type PreviewInputs,
} from "../lib/candidate-preview";
import type { Item } from "../types";

export interface PreviewCache {
  get(item: Item): CandidatePreview | null;
}

/** Each candidate resolves on first read and again only when something its resolve read
 *  changes, since the build is edited in place. Reading during render is safe: the entries
 *  live in a plain `Map` and each one is a lazy computed. */
export function previewCache(inputs: PreviewInputs): PreviewCache {
  const entries = new Map<string, ComputedRef<CandidatePreview | null>>();
  return {
    get(item) {
      let entry = entries.get(item.id);
      if (!entry) {
        entry = computed(() => candidatePreview(inputs, item));
        entries.set(item.id, entry);
      }
      return entry.value;
    },
  };
}

/** A fresh cache whenever `inputs` returns different inputs, and null while it returns none. */
export function useCandidatePreviews(
  inputs: () => PreviewInputs | undefined,
): ComputedRef<PreviewCache | null> {
  return computed(() => {
    const current = inputs();
    return current ? previewCache(current) : null;
  });
}
