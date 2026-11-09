// Which case each stat panel summary row shows (damage average, EHP crit / deflect, ...). A
// view preference shared by every build, stored in storage.ts's `UiState`.
import { reactive, watch } from "vue";
import * as storage from "../storage/storage";
import {
  DERIVED_TABLES,
  summaryCase,
  type DerivedSource,
} from "../lib/derived-tables";

const stored = storage.loadUiState().summaryCases ?? {};

const state = reactive(
  Object.fromEntries(
    DERIVED_TABLES.map((table) => [
      table.source,
      summaryCase(table, stored[table.source]),
    ]),
  ) as Record<DerivedSource, string>,
);

watch(state, () => {
  storage.saveUiState({ summaryCases: { ...state } });
});

export const summaryCases: Readonly<Record<DerivedSource, string>> = state;

export function setSummaryCase(source: DerivedSource, key: string) {
  state[source] = key;
}
