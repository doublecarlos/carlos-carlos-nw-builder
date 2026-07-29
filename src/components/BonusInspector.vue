<script setup lang="ts">
// The bonus inspector (plan §Phase 5, §2.5) -- the thing the spreadsheet could not do.
//
// The sheet could tell you a bonus was not applying. It could never tell you *why*, because
// its conditions were string matches evaluated inline with no record of what failed. The
// engine keeps `gate.leaves` / `gate.unmet` per bonus, each leaf already carrying a human
// `label` and `detail` ("duration ≥ 30s" / "you have 10s"), so this component mostly renders
// what it is handed -- see the handoff §4.
//
// Near-miss ordering is the useful part: inactive bonuses are sorted by how many conditions
// they fail, so the ones a single toggle or set piece away float to the top.
import { ref, reactive, computed } from 'vue';
import { label as statLabel, signedStat } from '../format';
import * as engine from '../stores/engine';
import type { EvaluatedBonus, ConditionLeafResult, StatValues } from '../types';

/** `m31-crimson-march-combat` -> `M31 Crimson March Combat`, for bonuses with no set name. */
const fromId = (id: string) => String(id ?? '')
  .replace(/[-_]+/g, ' ')
  .replace(/\b\w/g, (c) => c.toUpperCase());

/**
 * One item often carries several bonuses (an AoE variant and a single-target one, say) and
 * they all inherit the item's name, so the rows need something to tell them apart.
 *
 * The conditions do that in the user's own language -- "combat enabled + duration 10–30s".
 * The bonus id also distinguishes them, but only as generated slugs: the same two bonuses
 * come out as "combat combat short" and "combat medium plus combat", which is noise.
 */
const conditionSummary = (entry: EvaluatedBonus) => (entry.gate?.leaves ?? [])
  .map((leaf) => leaf.label)
  .filter(Boolean)
  .join(' + ');

// Only ever mounted when `engine.resolved.value.ok` -- the throw documents
// that invariant instead of a defensive fallback for a state that can't happen.
const result = computed(() => {
  const r = engine.resolved.value;
  if (!r.ok) throw new Error('BonusInspector requires a resolved build');
  return r.result;
});
const db = engine.db;

const query = ref('');
const nearMissOnly = ref(false);
const open = reactive<Record<string, boolean>>({});

function choseLabel(chose: string | null) {
  if (!chose || chose === 'stats') return '';
  const [kind, index] = chose.split(':');
  if (kind === 'tier') return `${index}-piece`;
  if (kind === 'variant') return `variant ${Number(index) + 1}`;
  return chose;
}

function statList(stats: StatValues | null | undefined) {
  if (!stats) return [];
  return Object.entries(stats)
    .map(([key, value]) => `${statLabel(key)} ${signedStat(key, value)}`);
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
  state: 'excluded' | 'active' | 'inactive';
}

const entries = computed<Entry[]>(() => {
  const titleCounts = new Map<string, number>();
  for (const entry of result.value.bonuses) {
    const title = entry.bonus?.name ?? entry.sources?.[0] ?? fromId(entry.id);
    titleCounts.set(title, (titleCounts.get(title) ?? 0) + 1);
  }

  return result.value.bonuses.map((entry) => {
    const unmet = entry.gate?.unmet ?? [];
    // The bonus's own friendly name is the most specific title; the item carrying it and
    // an id-derived fallback are progressively blunter instruments for one that has none.
    const title = entry.bonus?.name ?? entry.sources?.[0] ?? fromId(entry.id);
    return {
      raw: entry,
      id: entry.id,
      title,
      qualifier: (titleCounts.get(title) ?? 0) > 1 ? conditionSummary(entry) : '',
      sources: entry.sources ?? [],
      slot: db.value.slotById.get(entry.slotId)?.label ?? entry.slotId,
      stacks: entry.stacks ?? 1,
      chose: choseLabel(entry.chose),
      payload: entry.active ? (entry.appliedStats ?? null) : entry.previewStats,
      perStack: entry.stacks > 1 ? entry.stats : null,
      unmet,
      nearMiss: !entry.active && !entry.excluded && unmet.length === 1,
      state: entry.excluded ? 'excluded' : (entry.active ? 'active' : 'inactive'),
    };
  });
});

const filtered = computed(() => {
  const q = query.value.trim().toLowerCase();
  return entries.value.filter((entry) => {
    if (nearMissOnly.value && !entry.nearMiss) return false;
    if (!q) return true;
    return entry.title.toLowerCase().includes(q)
      || entry.id.toLowerCase().includes(q)
      || entry.sources.some((source) => source.toLowerCase().includes(q));
  });
});

const groups = computed(() => {
  const active = filtered.value.filter((entry) => entry.state === 'active');
  const excluded = filtered.value.filter((entry) => entry.state === 'excluded');
  // Fewest unmet conditions first: what you are closest to unlocking is what you want
  // to see, and a bonus failing five conditions is not actionable.
  const inactive = filtered.value.filter((entry) => entry.state === 'inactive')
    .sort((a, b) => a.unmet.length - b.unmet.length || a.title.localeCompare(b.title));
  return [
    { id: 'inactive', label: 'Inactive', list: inactive },
    { id: 'active', label: 'Active', list: active },
    { id: 'excluded', label: 'Excluded', list: excluded },
  ];
});

const counts = computed(() => {
  const all = entries.value;
  return {
    total: all.length,
    active: all.filter((entry) => entry.state === 'active').length,
    nearMiss: all.filter((entry) => entry.nearMiss).length,
  };
});
</script>

<template>
  <div class="panel">
    <div class="inspector-head">
      <input class="inspector-search" type="search" v-model="query"
             placeholder="Filter by bonus, set or item…">
      <div class="panel-meta">
        <span>{{ counts.active }}/{{ counts.total }} active</span>
        <label class="check check--inline">
          <input type="checkbox" v-model="nearMissOnly">
          <span>near misses only ({{ counts.nearMiss }})</span>
        </label>
      </div>
    </div>

    <template v-for="group in groups" :key="group.id">
      <h3 v-if="group.list.length" class="panel-head">
        {{ group.label }} <span class="dim">({{ group.list.length }})</span>
      </h3>

      <div v-for="entry in group.list" :key="entry.id"
           class="bonus" :class="'bonus--' + entry.state">
        <button type="button" class="bonus-head" @click="toggle(entry.id)">
          <span class="bonus-dot"></span>
          <span class="bonus-title">{{ entry.title }}</span>
          <span v-if="entry.qualifier" class="bonus-qualifier" :title="entry.qualifier">
            {{ entry.qualifier }}
          </span>
          <span v-if="entry.nearMiss" class="badge badge--near">1 away</span>
          <span v-if="entry.stacks > 1" class="badge">×{{ entry.stacks }}</span>
          <span v-if="entry.chose" class="badge">{{ entry.chose }}</span>
        </button>

        <!-- The payoff: for an inactive bonus, exactly which conditions failed and what
             they would need. Rendered verbatim from the engine. -->
        <ul v-if="entry.unmet.length" class="unmet">
          <li v-for="(leaf, i) in entry.unmet" :key="i">
            <span class="unmet-label">{{ leaf.label }}</span>
            <span v-if="leaf.detail" class="unmet-detail">— {{ leaf.detail }}</span>
            <ul v-if="leaf.children?.length" class="unmet-children">
              <li v-for="(child, j) in leaf.children" :key="j"
                  :class="{ 'is-ok': child.ok }">
                {{ child.ok ? '✓' : '✗' }} {{ child.label }}
                <span v-if="child.detail" class="unmet-detail">— {{ child.detail }}</span>
              </li>
            </ul>
          </li>
        </ul>

        <p v-if="entry.raw.excluded" class="unmet">
          <span class="unmet-label">overridden by</span>
          <span class="unmet-detail">{{ entry.raw.excludedBy }}</span>
        </p>

        <div v-if="open[entry.id]" class="bonus-detail">
          <div class="bonus-stats">
            <span v-for="part in statList(entry.payload)" :key="part" class="bonus-stat">
              {{ part }}
            </span>
            <span v-if="!statList(entry.payload).length" class="dim">no stat payload</span>
          </div>
          <p v-if="entry.perStack" class="hint">
            per stack: {{ statList(entry.perStack).join(', ') }}
          </p>
          <p class="hint">
            slot {{ entry.slot }} ·
            from {{ entry.sources.join(', ') || '—' }}
          </p>
          <p class="hint mono">{{ entry.id }}</p>
        </div>
      </div>
    </template>

    <p v-if="!filtered.length" class="dim" style="padding:10px 0">
      Nothing matches that filter.
    </p>
  </div>
</template>

<style scoped>
.inspector-head { position: sticky; top: 0; background: var(--surface); padding-bottom: 2px; z-index: 1; }
.inspector-search { width: 100%; }

.bonus { border-bottom: 1px solid color-mix(in srgb, var(--line) 50%, transparent); padding: 5px 0; }
.bonus:last-child { border-bottom: 0; }

.bonus-head {
  align-items: center;
  background: none;
  border: 0;
  color: inherit;
  cursor: pointer;
  display: flex;
  font: inherit;
  gap: 6px;
  padding: 0;
  text-align: left;
  width: 100%;
}
.bonus-head:hover .bonus-title { text-decoration: underline; }

/* Bonus state indicator (dot + title colour) -- same small vocabulary as ItemCard.vue's own
 * `.bonus-dot`/`.bonus--*`, duplicated rather than shared: see ItemCard.vue's own comment on
 * this. */
.bonus-dot { border-radius: 50%; flex: none; height: 7px; width: 7px; }
.bonus--active .bonus-dot { background: var(--ok); }
.bonus--inactive .bonus-dot { background: var(--muted); opacity: .5; }
.bonus--excluded .bonus-dot { background: var(--danger); }

.bonus-title { flex: none; max-width: 62%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.bonus-qualifier { color: var(--muted); flex: 1; font-size: 1rem; min-width: 0; overflow: hidden;
  text-overflow: ellipsis; white-space: nowrap; }
.bonus-head > .badge:first-of-type { margin-left: auto; }
.bonus--inactive .bonus-title, .bonus--excluded .bonus-title { color: var(--muted); }

.bonus-head .badge { background: var(--surface-2); color: var(--muted); flex: none; }
.bonus-head .badge--near { background: var(--accent-soft); color: var(--accent); }

.unmet { list-style: none; margin: 3px 0 0; padding: 0 0 0 13px; }
.unmet li { color: var(--muted); font-size: 1rem; }
.unmet-label { color: var(--warn); }
/* Vue condenses the whitespace between the label and detail spans away, so the gap has to
 * come from CSS or the em dash butts against the label. */
.unmet-detail { color: var(--muted); margin-left: .35em; }
.unmet-children { list-style: none; margin: 0; padding-left: 12px; }
.unmet-children li.is-ok { color: var(--ok); }

.bonus-detail { padding: 4px 0 2px 13px; }
.bonus-stats { display: flex; flex-wrap: wrap; gap: 4px 10px; }
.bonus-stat { font-size: 1rem; }
.bonus-detail .hint { display: block; margin: 2px 0 0; }
.mono { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
</style>
