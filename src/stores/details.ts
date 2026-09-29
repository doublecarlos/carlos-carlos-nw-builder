// Which BuildDetails tab is showing: the stat panel or the bonus inspector, and which bonus
// the inspector was asked to show.
import { computed, readonly, ref } from "vue";
import * as rails from "./rails";

const _tab = ref<"stats" | "bonuses">("stats");

export const tab = computed(() => _tab.value);

export function setTab(value: "stats" | "bonuses") {
  _tab.value = value;
}

const _inspect = ref<string | null>(null);

/** A bonus id the inspector should open and scroll to, until it consumes the request. */
export const inspectRequest = readonly(_inspect);

/** Shows `bonusId` in the inspector, opening the details column if it is collapsed. */
export function inspectBonus(bonusId: string) {
  _tab.value = "bonuses";
  if (rails.isCollapsed(rails.RAILS.details)) rails.toggle(rails.RAILS.details);
  _inspect.value = bonusId;
}

export function consumeInspect() {
  _inspect.value = null;
}
