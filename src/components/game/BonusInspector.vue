<script setup lang="ts">
import { ref, reactive, computed } from "vue";
import { bonusTitle } from "../../lib/format";
import { statList } from "../../lib/item-card-rows";
import { matchesQuery } from "../../lib/text-filter";
import { isHiddenBonus } from "../../engine/bonus";
import { hasSuppliers } from "../../lib/bonus-slots";
import { excluderFor } from "../../lib/item-card-rows";
import * as engine from "../../stores/resolved";
import * as goTo from "../../stores/goTo";
import * as slotFilter from "../../stores/slotFilter";
import BasePanel from "../ui/BasePanel.vue";
import PanelHead from "../ui/PanelHead.vue";
import BaseBadge from "../ui/BaseBadge.vue";
import BaseCheckbox from "../ui/BaseCheckbox.vue";
import BaseInput from "../ui/BaseInput.vue";
import BaseLink from "../ui/BaseLink.vue";
import LinkList from "../ui/LinkList.vue";
import type { LinkListItem } from "../ui/LinkList.vue";
import IconButton from "../ui/IconButton.vue";
import StatRows from "./StatRows.vue";
import { Crosshair } from "@lucide/vue";
import type {
  BonusSource,
  EvaluatedBonus,
  ConditionLeafResult,
  StatValues,
} from "../../types";

/**
 * One item often carries several bonuses (an AoE variant and a single-target one, say) and
 * they all inherit the item's name, so the rows need something to tell them apart.
 *
 * The conditions do that in the user's own language: "combat enabled + duration 10-30s".
 * The bonus id also distinguishes them, but only as generated slugs: the same two bonuses
 * come out as "combat combat short" and "combat medium plus combat", which is noise.
 */
const conditionSummary = (entry: EvaluatedBonus) =>
  (entry.gate?.leaves ?? [])
    .map((leaf) => leaf.label)
    .filter(Boolean)
    .join(" + ");

// Only ever mounted when `engine.resolved.value.ok` -- the throw documents
// that invariant instead of a defensive fallback for a state that can't happen.
const result = computed(() => {
  const r = engine.resolved.value;
  if (!r.ok) throw new Error("BonusInspector requires a resolved build");
  return r.result;
});
const db = engine.db;

const query = ref("");
const nearMissOnly = ref(false);
const open = reactive<Record<string, boolean>>({});

function choseLabel(chose: string | null) {
  if (!chose || chose === "stats") return "";
  const [kind, value] = chose.split(":");
  if (kind === "tier") return `${value} equipped`;
  if (kind === "variant") return `variant ${Number(value) + 1}`;
  return chose;
}

/** Narrows the build editor's slot list to the rows that could supply this bonus. The list is
 *  in the next column over, already on screen, so there is nothing to navigate to. */
function locate(entry: Entry) {
  slotFilter.showSuppliersOf(entry.id, entry.title);
}

/** Parks the build editor's cursor on a row this bonus comes from. */
function jumpToSlot(slotId: string) {
  goTo.requestJump({ slotId });
}

function statText(stats: StatValues | null | undefined): string {
  return statList(stats)
    .map((row) => `${row.label} ${row.value}`)
    .join(", ");
}

function toggle(id: string) {
  open[id] = !open[id];
}

interface Entry {
  raw: EvaluatedBonus;
  id: string;
  title: string;
  qualifier: string;
  sources: LinkListItem[];
  slot: string;
  /** The bonus that won over this one, with its instancing slot to jump to; an id the build
   *  no longer resolves keeps only its text. */
  excludedBy: BonusSource | null;
  stacks: number;
  chose: string;
  payload: StatValues | null;
  perStack: StatValues | null;
  unmet: ConditionLeafResult[];
  nearMiss: boolean;
  /** Whether anything in the catalog could supply this, so the "where?" action leads
   *  somewhere. Always false for an already-active bonus: the answer is "where it is". */
  canLocate: boolean;
  state: "excluded" | "active" | "inactive";
  dotClass: string;
  muted: boolean;
}

// Same small vocabulary as ItemCard.vue's own per-row state coloring, duplicated rather than
// shared: the two live in different visual contexts (a hover card vs. this sidebar list).
const STATE_DOT: Record<string, string> = {
  active: "bg-ok",
  inactive: "bg-muted opacity-50",
  excluded: "bg-danger",
};

// Problem-only bonuses (a bonus that exists purely to report a build error/warning) are
// already surfaced inline on their slot and in the errors summary -- listing them here too,
// especially while inactive, reads as a bonus that never grants anything.
const visibleBonuses = computed(() =>
  result.value.bonuses.filter((entry) => !isHiddenBonus(entry.bonus)),
);

const entries = computed<Entry[]>(() => {
  const titleCounts = new Map<string, number>();
  for (const entry of visibleBonuses.value) {
    const title = bonusTitle(entry);
    titleCounts.set(title, (titleCounts.get(title) ?? 0) + 1);
  }

  return visibleBonuses.value.map((entry) => {
    const unmet = entry.gate?.unmet ?? [];
    const title = bonusTitle(entry);
    const state = entry.excluded
      ? "excluded"
      : entry.active
        ? "active"
        : "inactive";
    return {
      raw: entry,
      id: entry.id,
      title,
      qualifier:
        (titleCounts.get(title) ?? 0) > 1 ? conditionSummary(entry) : "",
      sources: (entry.sources ?? []).map((source) => ({
        key: source.slotId,
        label: source.name,
      })),
      slot: db.value.slotFor(entry.slotId)?.label ?? entry.slotId,
      excludedBy: excluderFor(entry, engine.bonusById.value),
      stacks: entry.stacks ?? 1,
      chose: choseLabel(entry.chose),
      payload: entry.active ? (entry.appliedStats ?? null) : entry.previewStats,
      perStack: entry.stacks > 1 ? entry.stats : null,
      unmet,
      nearMiss: !entry.active && !entry.excluded && unmet.length === 1,
      canLocate: !entry.active && hasSuppliers(db.value, entry.id),
      state,
      dotClass: STATE_DOT[state],
      muted: state !== "active",
    };
  });
});

const filtered = computed(() => {
  return entries.value.filter((entry) => {
    if (nearMissOnly.value && !entry.nearMiss) return false;
    return matchesQuery(
      [entry.title, entry.id, ...entry.sources.map((s) => s.label)],
      query.value,
    );
  });
});

const groups = computed(() => {
  const active = filtered.value.filter((entry) => entry.state === "active");
  const excluded = filtered.value.filter((entry) => entry.state === "excluded");
  // Fewest unmet conditions first: what you are closest to unlocking is what you want
  // to see, and a bonus failing five conditions is not actionable.
  const inactive = filtered.value
    .filter((entry) => entry.state === "inactive")
    .sort(
      (a, b) =>
        a.unmet.length - b.unmet.length || a.title.localeCompare(b.title),
    );
  return [
    { id: "inactive", label: "Inactive", list: inactive },
    { id: "active", label: "Active", list: active },
    { id: "excluded", label: "Excluded", list: excluded },
  ];
});

const counts = computed(() => {
  const all = entries.value;
  return {
    total: all.length,
    active: all.filter((entry) => entry.state === "active").length,
    nearMiss: all.filter((entry) => entry.nearMiss).length,
  };
});
</script>

<template>
  <BasePanel>
    <div class="sticky top-0 z-sticky bg-surface pb-0.5">
      <BaseInput
        v-model="query"
        class="w-full"
        type="search"
        placeholder="Filter by bonus, id or item…"
      />
      <div class="flex items-center gap-3 py-2 text-muted">
        <span>{{ counts.active }}/{{ counts.total }} active bonuses</span>
        <BaseCheckbox v-model="nearMissOnly" inline class="ml-auto"
          >near misses only ({{ counts.nearMiss }})</BaseCheckbox
        >
      </div>
    </div>

    <template v-for="group in groups" :key="group.id">
      <PanelHead v-if="group.list.length">
        {{ group.label }}
        <span class="text-muted">({{ group.list.length }})</span>
      </PanelHead>

      <div class="divide-y divide-line/50">
        <div v-for="entry in group.list" :key="entry.id" class="py-1.5">
          <div class="flex w-full items-center gap-1.5">
            <button
              type="button"
              class="group flex min-w-0 flex-1 items-center gap-1.5 text-left cursor-pointer"
              @click="toggle(entry.id)"
            >
              <span
                class="size-1.5 flex-none rounded-full"
                :class="entry.dotClass"
              ></span>
              <span
                class="max-w-3/5 flex-none overflow-hidden text-ellipsis whitespace-nowrap group-hover:underline"
                :class="entry.muted && 'text-muted'"
                >{{ entry.title }}</span
              >
              <span
                v-if="entry.qualifier"
                class="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap text-muted"
                :title="entry.qualifier"
              >
                {{ entry.qualifier }}
              </span>
              <BaseBadge v-if="entry.nearMiss" class="ml-auto flex-none"
                >1 away</BaseBadge
              >
              <span
                v-if="entry.stacks > 1"
                class="flex-none rounded-full bg-surface-2 px-1.5 font-semibold text-muted"
                >×{{ entry.stacks }}</span
              >
              <span
                v-if="entry.chose"
                class="flex-none rounded-full bg-surface-2 px-1.5 font-semibold text-muted"
                >{{ entry.chose }}</span
              >
            </button>

            <!-- Sibling of the expand button rather than inside it: nesting a button in a button
             is invalid, and these are two different questions -- "what is failing" and
             "where would I get it". -->
            <IconButton
              v-if="entry.canLocate"
              class="flex-none"
              title="Show the slots that could supply this"
              :data-testid="`bonus-locate-${entry.id}`"
              @click="locate(entry)"
            >
              <Crosshair />
            </IconButton>
          </div>

          <!-- The payoff: for an inactive bonus, exactly which conditions failed and what
             they would need. Rendered verbatim from the engine. -->
          <ul v-if="entry.unmet.length" class="mt-1 list-none pl-3.5">
            <li v-for="(leaf, i) in entry.unmet" :key="i" class="text-muted">
              <span class="text-warn">{{ leaf.label }}</span>
              <span v-if="leaf.detail" class="ml-1 text-muted"
                >- {{ leaf.detail }}</span
              >
              <ul v-if="leaf.children?.length" class="list-none pl-3">
                <li
                  v-for="(child, j) in leaf.children"
                  :key="j"
                  :class="child.ok && 'text-ok'"
                >
                  {{ child.ok ? "✓" : "✗" }} {{ child.label }}
                  <span v-if="child.detail" class="ml-1 text-muted"
                    >- {{ child.detail }}</span
                  >
                </li>
              </ul>
            </li>
          </ul>

          <p
            v-if="entry.excludedBy"
            class="mt-1 pl-3.5 text-muted"
            data-testid="bonus-excluded-by"
          >
            <span class="text-warn">overridden by</span>
            <BaseLink
              class="ml-1"
              :plain="!entry.excludedBy.slotId"
              @click="jumpToSlot(entry.excludedBy.slotId)"
              >{{ entry.excludedBy.name }}</BaseLink
            >
          </p>

          <div v-if="open[entry.id]" class="pb-0.5 pl-3.5 pt-1">
            <StatRows
              :rows="statList(entry.payload)"
              :active="entry.state === 'active'"
              empty-text="no stats granted"
              row-testid="bonus-stat-row"
            />
            <p v-if="entry.perStack" class="mt-1 block text-muted">
              per stack: {{ statText(entry.perStack) }}
            </p>
            <p class="mt-1 block text-muted">
              slot
              <BaseLink
                data-testid="bonus-slot-link"
                @click="jumpToSlot(entry.raw.slotId)"
                >{{ entry.slot }}</BaseLink
              >
            </p>
            <p class="mt-1 block text-muted">
              from
              <LinkList
                v-if="entry.sources.length"
                :items="entry.sources"
                link-testid="bonus-source-link"
                @select="jumpToSlot"
              />
              <template v-else>-</template>
            </p>
            <p class="mt-1 block font-mono text-muted">{{ entry.id }}</p>
          </div>
        </div>
      </div>
    </template>

    <p v-if="!filtered.length" class="py-2.5 text-muted">
      Nothing matches the filter.
    </p>
  </BasePanel>
</template>
