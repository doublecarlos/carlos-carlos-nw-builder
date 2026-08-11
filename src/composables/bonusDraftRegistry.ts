// Shared registry letting a condition dragged out of one bonus's tree be dropped into another
// bonus's tree, when several bonuses are edited side by side (ItemBonuses.vue, one item's
// "Bonuses" section). ItemBonuses provides the registry once; each BonusForm instance
// registers its own BonusDraftStore under its slot's stable key on mount and unregisters on
// unmount -- a real, bounded ownership relationship (unlike drag-and-drop's own ephemeral
// module-scope state in useDragAndDrop.ts, which has no single owning component).
import type { InjectionKey } from "vue";
import type { BonusDraftStore } from "../stores/bonus-draft";

export const bonusDraftRegistryKey: InjectionKey<Map<string, BonusDraftStore>> =
  Symbol("bonusDraftRegistry");
