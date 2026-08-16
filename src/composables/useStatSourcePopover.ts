import { ref, computed, type Ref, type ComputedRef } from "vue";
import { onClickOutside } from "@vueuse/core";
import { sectionsFor } from "../engine/stat-sources";
import { NW_SCHEMA } from "../data/data";
import type BasePanel from "../components/ui/BasePanel.vue";
import type BasePopover from "../components/ui/BasePopover.vue";
import type { ResolvedBuild, Build, Db } from "../types";

/**
 * StatPanel's "why is this number what it is" popover: click a stat's info button, get a
 * card breaking its value down by source. Click-triggered rather than hover-triggered -- a
 * dense stat table put the pointer's path from a row to its own hover card through *other*
 * rows' triggers often enough that a hover card kept getting swapped out from under the
 * pointer before it ever arrived; a deliberate click has no such transit to go wrong.
 */
export function useStatSourcePopover(
  result: Ref<ResolvedBuild> | ComputedRef<ResolvedBuild>,
  build: Ref<Build>,
  db: Ref<Db>,
) {
  const root = ref<InstanceType<typeof BasePanel> | null>(null);
  const tooltip = ref<InstanceType<typeof BasePopover> | null>(null);

  interface OpenCard {
    key: string;
  }
  const openCard = ref<OpenCard | null>(null);

  const openLabel = computed(
    () =>
      NW_SCHEMA.statByKey[openCard.value?.key ?? ""]?.label ??
      openCard.value?.key ??
      "",
  );
  const openSections = computed(() =>
    openCard.value
      ? sectionsFor(result.value, build.value, db.value, openCard.value.key)
      : [],
  );

  /**
   * Anchored to the trigger button: delegates to BasePopover's place() which handles
   * horizontal flip and vertical overflow detection.
   */
  function placeCard(key: string, rect: DOMRect) {
    tooltip.value?.place(rect);
    openCard.value = { key };
  }

  function closeCard() {
    openCard.value = null;
  }

  /** A second click on the same row's own button closes it again; a click on a *different*
   * row's button just switches the card straight over. */
  function toggleCard(event: MouseEvent, key: string) {
    if (openCard.value?.key === key) {
      closeCard();
      return;
    }
    placeCard(
      key,
      (event.currentTarget as HTMLElement).getBoundingClientRect(),
    );
  }

  /** Closes the popover on any click outside it -- `onClickOutside` ignores clicks on
   * the card itself (`.statcard`) and on other stat info buttons (`.stat-info-btn`),
   * so a click on a different row's trigger reaches `toggleCard` and switches the card
   * over instead of closing it first. */
  onClickOutside(tooltip, () => closeCard(), {
    ignore: [".statcard", ".stat-info-btn"],
    capture: false,
  });

  return {
    root,
    tooltip,
    openCard,
    openLabel,
    openSections,
    toggleCard,
    closeCard,
  };
}
