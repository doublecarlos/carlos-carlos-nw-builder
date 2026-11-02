import {
  computed,
  provide,
  ref,
  type ComputedRef,
  type InjectionKey,
  type Ref,
} from "vue";
import { sectionsFor } from "../engine/stat-sources";
import { NW_SCHEMA } from "../data/data";
import * as goTo from "../stores/goTo";
import { coarsePointer, isPhone } from "../stores/viewport";
import { useHoverCard } from "./useHoverCard";
import type BasePopover from "../components/ui/BasePopover.vue";
import type { ResolvedBuild } from "../types";

/** What a stat row's info button reports to the panel's one source card. */
export interface StatSourceTrigger {
  enter: (event: MouseEvent, key: string) => void;
  leave: () => void;
  toggle: (event: MouseEvent, key: string) => void;
}

export const STAT_SOURCE_TRIGGER: InjectionKey<StatSourceTrigger> = Symbol(
  "stat-source-trigger",
);

/**
 * StatPanel's "why is this number what it is" card: hovering a stat's info button previews a
 * card breaking its value down by source, and clicking the button opens it pinned. The same
 * hover card as the build editor's item card (useHoverCard), triggered by the button rather
 * than the whole row: in a dense table the pointer's path to a row's card would otherwise run
 * through other rows and swap the card out from under it.
 *
 * The card opens to the left of the panel, so that path never crosses the column of buttons.
 * Provides the trigger the buttons inject (StatInfoButton.vue).
 */
export function useStatSourcePopover(
  result: Ref<ResolvedBuild> | ComputedRef<ResolvedBuild>,
) {
  const tooltip = ref<InstanceType<typeof BasePopover> | null>(null);

  /** The row's height, at the left edge of the panel StatPanel marks `data-stat-panel`. */
  function besidePanel(button: HTMLElement): DOMRect {
    const row = (button.closest("tr") ?? button).getBoundingClientRect();
    const panel = button.closest("[data-stat-panel]")?.getBoundingClientRect();
    return new DOMRect(panel?.left ?? row.left, row.top, 0, row.height);
  }

  const card = useHoverCard<{ key: string }>(tooltip, () => true, {
    disabled: coarsePointer,
    anchor: besidePanel,
    align: "before",
  });

  const openKey = computed(() => card.hover.value?.key ?? null);

  const openLabel = computed(
    () =>
      NW_SCHEMA.statByKey[openKey.value ?? ""]?.label ?? openKey.value ?? "",
  );
  const openSections = computed(() =>
    openKey.value ? sectionsFor(result.value, openKey.value) : [],
  );

  /** A source line's link: an unpinned card gives way to the build row it names. On a phone
   *  the jump switches panes, so even a pinned card would be left over the wrong one. */
  function goToSlot(slotId: string) {
    if (!card.pinned.value || isPhone.value) card.closeCard();
    goTo.requestJump({ slotId });
  }

  provide(STAT_SOURCE_TRIGGER, {
    enter: (event, key) => card.onRowEnter(event, { key }),
    leave: card.onRowLeave,
    toggle: (event, key) =>
      card.togglePinned({ key }, event.currentTarget as HTMLElement),
  });

  return {
    tooltip,
    openKey,
    pinned: card.pinned,
    pin: card.pin,
    closeCard: card.closeCard,
    onCardEnter: card.onCardEnter,
    onCardLeave: card.onCardLeave,
    openLabel,
    openSections,
    goToSlot,
  };
}
