// Which BuildDetails tab is showing: the stat panel or the bonus inspector.
import { computed, ref } from 'vue';

const _tab = ref<'stats' | 'bonuses'>('stats');

export const tab = computed(() => _tab.value);

export function setTab(value: 'stats' | 'bonuses') {
  _tab.value = value;
}
