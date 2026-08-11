<script setup lang="ts">
// The bonus inspector -- the thing the spreadsheet could not do.
//
// The sheet could tell you a bonus was not applying. It could never tell you *why*, because
// its conditions were string matches evaluated inline with no record of what failed. The
// engine keeps `gate.leaves` / `gate.unmet` per bonus, each leaf already carrying a human
// `label` and `detail` ("duration ≥ 30s" / "you have 10s"), so this component mostly renders
// what it is handed.
//
// Near-miss ordering is the useful part: inactive bonuses are sorted by how many conditions
// they fail, so the ones a single toggle or bonus occurrence away float to the top.
import { ref, reactive, computed } from "vue";
import { label as statLabel, signedStat } from "../../lib/format";
import { matchesQuery } from "../../lib/text-filter";
import { isHiddenBonus } from "../../engine/bonus";
import * as engine from "../../stores/resolved";
import BasePanel from "../ui/BasePanel.vue";
import PanelHead from "../ui/PanelHead.vue";
import BaseBadge from "../ui/BaseBadge.vue";
import BaseCheckbox from "../ui/BaseCheckbox.vue";
import type {
  EvaluatedBonus,
  ConditionLeafResult,
  StatValues,
} from "../../types";

/** `m31-crimson-march-combat` -> `M31 Crimson March Combat`, for bonuses with no set name. */
const fromId = (id: string) =>
  String(id ?? "")
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());

/**
 * One item often carries several bonuses (an AoE variant and a single-target one, say) and
 * they all inherit the item's name, so the rows need something to tell them apart.
 *
 * The conditions do that in the user's own language -- "combat enabled + duration 10–30s".
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

function statList(stats: StatValues | null | undefined) {
  if (!stats) return [];
  return Object.entries(stats).map(
    ([key, value]) => `${statLabel(key)} ${signedStat(key, value)}`,
  );
}

function toggle(id: string) {
  open[id] = !open[id];
}

interface Entry {
  raw: EvaluatedBonus;
  id: string;
  title: string;
  qualifier: string;
  sources: string[];
  slot: string;
  stacks: number;
  chose: string;
  payload: StatValues | null;
  perStack: StatValues | null;
  unmet: ConditionLeafResult[];
  nearMiss: boolean;
  state: "excluded" | "active" | "inactive";
  dotClass: string;
  muted: boolean;
}

// Same small vocabulary as ItemCard.vue's own per-row state colouring, duplicated rather than
// shared: the two live in different visual contexts (a hover card vs. this sidebar list).
const STATE_DOT: Record<string, string> = {
  active: "bg-ok",
  inactive: "bg-muted opacity-50",
  excluded: "bg-danger",
};

// Problem-only bonuses (a set that exists purely to report a build error/warning) are
// already surfaced inline on their slot and in the errors summary -- listing them here too,
// especially while inactive, reads as a bonus that never grants anything.
const visibleBonuses = computed(() =>
  result.value.bonuses.filter((entry) => !isHiddenBonus(entry.bonus)),
);

const entries = computed<Entry[]>(() => {
  const titleCounts = new Map<string, number>();
  for (const entry of visibleBonuses.value) {
    const title = entry.bonus?.name ?? entry.sources?.[0] ?? fromId(entry.id);
    titleCounts.set(title, (titleCounts.get(title) ?? 0) + 1);
  }

  return visibleBonuses.value.map((entry) => {
    const unmet = entry.gate?.unmet ?? [];
    // The bonus's own friendly name is the most specific title; the item carrying it and
    // an id-derived fallback are progressively blunter instruments for one that has none.
    const title = entry.bonus?.name ?? entry.sources?.[0] ?? fromId(entry.id);
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
      sources: entry.sources ?? [],
      slot: db.value.slotById.get(entry.slotId)?.label ?? entry.slotId,
      stacks: entry.stacks ?? 1,
      chose: choseLabel(entry.chose),
      payload: entry.active ? (entry.appliedStats ?? null) : entry.previewStats,
      perStack: entry.stacks > 1 ? entry.stats : null,
      unmet,
      nearMiss: !entry.active && !entry.excluded && unmet.length === 1,
      state,
      dotClass: STATE_DOT[state],
      muted: state !== "active",
    };
  });
});

const filtered = computed(() => {
  return entries.value.filter((entry) => {
    if (nearMissOnly.value && !entry.nearMiss) return false;
    return matchesQuery([entry.title, entry.id, ...entry.sources], query.value);
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
  <BasePanel flush>
    <div class="sticky top-0 z-1 bg-surface pb-0.5">
      <input
        v-model="query"
        class="w-full rounded-md border border-line bg-surface px-1.5 py-0.5 focus:outline-2 focus:-outline-offset-1 focus:outline-accent"
        type="search"
        placeholder="Filter by bonus, set or item…"
      />
      <div class="flex items-center gap-3 py-2 text-sm text-muted">
        <span>{{ counts.active }}/{{ counts.total }} active</span>
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

      <div
        v-for="entry in group.list"
        :key="entry.id"
        class="border-b border-line/50 py-1.5 last:border-b-0"
      >
        <button
          type="button"
          class="group flex w-full items-center gap-1.5 text-left cursor-pointer"
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
            class="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap text-sm text-muted"
            :title="entry.qualifier"
          >
            {{ entry.qualifier }}
          </span>
          <BaseBadge v-if="entry.nearMiss" class="ml-auto flex-none"
            >1 away</BaseBadge
          >
          <span
            v-if="entry.stacks > 1"
            class="flex-none rounded-full bg-surface-2 px-1.5 text-sm font-semibold text-muted"
            >×{{ entry.stacks }}</span
          >
          <span
            v-if="entry.chose"
            class="flex-none rounded-full bg-surface-2 px-1.5 text-sm font-semibold text-muted"
            >{{ entry.chose }}</span
          >
        </button>

        <!-- The payoff: for an inactive bonus, exactly which conditions failed and what
             they would need. Rendered verbatim from the engine. -->
        <ul v-if="entry.unmet.length" class="mt-1 list-none pl-3.5">
          <li
            v-for="(leaf, i) in entry.unmet"
            :key="i"
            class="text-sm text-muted"
          >
            <span class="text-warn">{{ leaf.label }}</span>
            <span v-if="leaf.detail" class="ml-1 text-muted"
              >— {{ leaf.detail }}</span
            >
            <ul v-if="leaf.children?.length" class="list-none pl-3">
              <li
                v-for="(child, j) in leaf.children"
                :key="j"
                :class="child.ok && 'text-ok'"
              >
                {{ child.ok ? "✓" : "✗" }} {{ child.label }}
                <span v-if="child.detail" class="ml-1 text-muted"
                  >— {{ child.detail }}</span
                >
              </li>
            </ul>
          </li>
        </ul>

        <p v-if="entry.raw.excluded" class="mt-1 pl-3.5 text-sm text-muted">
          <span class="text-warn">overridden by</span>
          <span class="ml-1 text-muted">{{ entry.raw.excludedBy }}</span>
        </p>

        <div v-if="open[entry.id]" class="pb-0.5 pl-3.5 pt-1">
          <div class="flex flex-wrap gap-x-2.5 gap-y-1 text-sm">
            <span v-for="part in statList(entry.payload)" :key="part">{{
              part
            }}</span>
            <span v-if="!statList(entry.payload).length" class="text-muted"
              >no stat payload</span
            >
          </div>
          <p v-if="entry.perStack" class="mt-1 block text-sm text-muted">
            per stack: {{ statList(entry.perStack).join(", ") }}
          </p>
          <p class="mt-1 block text-sm text-muted">
            slot {{ entry.slot }} · from {{ entry.sources.join(", ") || "—" }}
          </p>
          <p class="mt-1 block font-mono text-sm text-muted">{{ entry.id }}</p>
        </div>
      </div>
    </template>

    <p v-if="!filtered.length" class="py-2.5 text-muted">
      Nothing matches that filter.
    </p>
  </BasePanel>
</template>
