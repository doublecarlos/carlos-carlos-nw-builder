// Editor for a list of bonuses.
//
// Item bonuses and set effects turned out to be the same editing problem: both are
// `{ id, when, stats|tiers|variants }`, so one component serves both and the set editor
// reuses it.
//
// What the form covers structurally: the condition tree (leaves plus `all`/`any`/`not`, see
// condition-rows.js), a flat stat payload, a *tiered* payload keyed on set pieces, and a
// *variants* payload (first matching condition wins), plus the stacking rules (`stacking`,
// `maxStacks`, `excludes`). Only conditions nested deeper than `conditionDraft.MAX_DEPTH`,
// unrecognized condition keys, complex tiers, or a bonus using both `tiers` and `variants`
// fall through to the JSON escape hatch -- the editor never silently flattens a structure it
// has no widget for.
//
// The draft <-> bonus conversion lives on `window.NW.bonusDraft` so item-form and set-bonuses
// can build and read drafts without importing the component.

window.NW = window.NW ?? {};
window.NW.components = window.NW.components ?? {};

window.NW.bonusDraft = (() => {
  'use strict';

  const cd = () => window.NW.conditionDraft;

  // Exactly what the engine reads off a tier (bonus.js `evaluateBonus`). Anything else on a
  // tier would be dropped by the form, so its presence forces JSON mode instead.
  const TIER_KEYS = new Set(['pieces', 'stats']);
  const PIECES_KEYS = new Set(['set', 'atLeast']);
  const VARIANT_KEYS = new Set(['when', 'stats']);

  const tiersAreSimple = (tiers) => (tiers ?? []).every((tier) => (
    Object.keys(tier).every((key) => TIER_KEYS.has(key))
    && tier.pieces && typeof tier.pieces === 'object'
    && Object.keys(tier.pieces).every((key) => PIECES_KEYS.has(key))
  ));

  const variantsAreSimple = (variants) => (variants ?? []).every((variant) => (
    Object.keys(variant).every((key) => VARIANT_KEYS.has(key))
    && variant.stats && typeof variant.stats === 'object'
    && cd().whenIsRepresentable(variant.when)
  ));

  /** Structures the form cannot represent without losing something. */
  const needsJson = (bonus) => Boolean(
    !cd().whenIsRepresentable(bonus.when)
    || (bonus.tiers && !tiersAreSimple(bonus.tiers))
    || (bonus.variants && (bonus.tiers || !variantsAreSimple(bonus.variants))),
  );

  const statRows = (stats) => Object.entries(stats ?? {})
    .map(([key, value]) => ({ key, value }));

  const rowsToStats = (rows) => {
    const stats = {};
    for (const { key, value } of rows ?? []) {
      const number = Number(value);
      if (!key || value === '' || value == null || !Number.isFinite(number)) continue;
      stats[key] = number;
    }
    return stats;
  };

  const newVariant = () => ({
    uid: `v${Math.random().toString(36).slice(2, 8)}`,
    conditions: [],
    stats: [],
  });

  function toDraft(bonus = {}) {
    const json = needsJson(bonus);
    return {
      uid: `b${Math.random().toString(36).slice(2, 8)}`,
      id: bonus.id ?? '',
      name: bonus.name ?? '',
      mode: json ? 'json' : 'simple',
      json: JSON.stringify(bonus, null, 2),
      conditions: json ? [] : cd().whenToRows(bonus.when),
      payload: bonus.variants ? 'variants' : (bonus.tiers ? 'tiers' : 'flat'),
      stats: json ? [] : statRows(bonus.stats),
      tiers: json ? [] : (bonus.tiers ?? []).map((tier) => ({
        set: tier.pieces?.set ?? '',
        atLeast: tier.pieces?.atLeast ?? 1,
        stats: statRows(tier.stats),
      })),
      variants: json ? [] : (bonus.variants ?? []).map((variant) => ({
        ...newVariant(),
        conditions: cd().whenToRows(variant.when),
        stats: statRows(variant.stats),
      })),
      stacking: bonus.stacking ?? '',
      maxStacks: bonus.maxStacks ?? null,
      excludes: [...(bonus.excludes ?? [])],
    };
  }

  /** Throws on unparseable JSON so the caller can report it rather than dropping the bonus. */
  function toBonus(draft) {
    if (draft.mode === 'json') return JSON.parse(draft.json);

    const out = { id: draft.id.trim() };
    if (draft.name.trim()) out.name = draft.name.trim();
    const when = cd().rowsToWhen(draft.conditions);
    if (Object.keys(when).length) out.when = when;

    if (draft.payload === 'tiers') {
      out.tiers = draft.tiers.map((tier) => ({
        pieces: { set: tier.set, atLeast: Number(tier.atLeast) || 1 },
        stats: rowsToStats(tier.stats),
      }));
    } else if (draft.payload === 'variants') {
      out.variants = draft.variants.map((variant) => {
        const vWhen = cd().rowsToWhen(variant.conditions);
        const entry = { stats: rowsToStats(variant.stats) };
        if (Object.keys(vWhen).length) entry.when = vWhen;
        return entry;
      });
    } else {
      out.stats = rowsToStats(draft.stats);
    }

    if (draft.stacking) out.stacking = draft.stacking;
    if (draft.maxStacks) out.maxStacks = Number(draft.maxStacks);
    if (draft.excludes?.length) out.excludes = [...draft.excludes];

    return out;
  }

  /** Deep clone, with fresh uids throughout and the id suffixed so the copy does not collide
   * with the original on save. */
  function duplicateDraft(draft) {
    return {
      ...draft,
      uid: `b${Math.random().toString(36).slice(2, 8)}`,
      id: draft.id ? `${draft.id}-copy` : '',
      conditions: draft.conditions.map(cd().cloneRow),
      stats: draft.stats.map((s) => ({ ...s })),
      tiers: draft.tiers.map((tier) => ({ ...tier, stats: tier.stats.map((s) => ({ ...s })) })),
      variants: draft.variants.map((variant) => ({
        ...newVariant(),
        conditions: variant.conditions.map(cd().cloneRow),
        stats: variant.stats.map((s) => ({ ...s })),
      })),
      excludes: [...draft.excludes],
    };
  }

  return { needsJson, toDraft, toBonus, duplicateDraft, statRows, rowsToStats, newVariant };
})();

window.NW.components.BonusRows = (() => {
  'use strict';

  const api = () => window.NW.bonusDraft;
  const cd = () => window.NW.conditionDraft;

  const slugify = (text) => String(text).toLowerCase().trim()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

  /** Shared by every reorderable list here (bonuses, tiers, variants). */
  const moveItem = (list, index, delta) => {
    const to = index + delta;
    if (to < 0 || to >= list.length) return;
    const [item] = list.splice(index, 1);
    list.splice(to, 0, item);
  };

  return {
    name: 'BonusRows',

    components: {
      TokenInput: window.NW.components.TokenInput,
      PercentInput: window.NW.components.PercentInput,
      ComboBox: window.NW.components.ComboBox,
      ConditionRows: window.NW.components.ConditionRows,
      IconButton: window.NW.components.IconButton,
    },

    props: {
      // Mutated in place. The parent owns the draft array and re-reads it on save; passing a
      // reactive array down is the least ceremonious way to edit a list of sub-objects.
      rows: { type: Array, required: true },
      setIds: { type: Array, default: () => [] },
      tags: { type: Array, default: () => [] },
      bonusIds: { type: Array, default: () => [] },
      idPlaceholder: { type: String, default: 'bonus id' },
    },

    emits: ['error'],

    computed: {
      statOptions: () => window.NW_SCHEMA.stats,

      statComboOptions() {
        return this.statOptions.map((s) => ({ value: s.key, label: `${s.label} (${s.key})` }));
      },

      setComboOptions() {
        return this.setIds.map((s) => ({ value: s, label: s }));
      },

      stackingOptions: () => ([
        { value: '', label: 'once, however many sources' },
        { value: 'perSource', label: 'once per contributing slot' },
      ]),
    },

    methods: {
      isPercent: (key) => window.NW.format.isPercentKind(window.NW.format.kindOf(key)),

      /** Fill the id field from the current name -- same convention as the bonus group's own
       * id-generate button. */
      generateId(bonus) { bonus.id = slugify(bonus.name) || bonus.id; },

      addBonus() { this.rows.push(api().toDraft({ id: '', when: {}, stats: {} })); },
      removeBonus(index) { this.rows.splice(index, 1); },
      insertBonus(index) { this.rows.splice(index + 1, 0, api().toDraft({ id: '', when: {}, stats: {} })); },
      duplicateBonus(index) { this.rows.splice(index + 1, 0, api().duplicateDraft(this.rows[index])); },
      moveBonus(index, delta) { moveItem(this.rows, index, delta); },

      toggleJson(bonus) {
        if (bonus.mode === 'simple') {
          bonus.json = JSON.stringify(api().toBonus(bonus), null, 2);
          bonus.mode = 'json';
          return;
        }
        try {
          const parsed = JSON.parse(bonus.json);
          if (api().needsJson(parsed)) {
            this.$emit('error', 'That bonus is too complex for the form (an unrecognized '
              + 'condition, tiers combined with variants, or conditions nested deeper than '
              + `${window.NW.conditionDraft.MAX_DEPTH} levels). Keeping it as JSON.`);
            return;
          }
          Object.assign(bonus, api().toDraft(parsed), { uid: bonus.uid, mode: 'simple' });
          this.$emit('error', '');
        } catch (error) {
          this.$emit('error', `Cannot switch to the form: ${error.message}`);
        }
      },

      addStat(rows) { rows.push({ key: '', value: 0 }); },
      removeStat(rows, index) { rows.splice(index, 1); },

      /**
       * Tier payloads are absolute, not cumulative: the highest matching threshold wins and
       * replaces the lower one (bonus.js). A new tier therefore starts from a copy of the
       * previous one, which is nearly always the intent.
       */
      addTier(bonus) {
        const last = bonus.tiers[bonus.tiers.length - 1];
        bonus.tiers.push({
          set: last?.set ?? this.setIds[0] ?? '',
          atLeast: (last?.atLeast ?? 0) + 1,
          stats: last ? last.stats.map((s) => ({ ...s })) : [],
        });
      },

      removeTier(bonus, index) { bonus.tiers.splice(index, 1); },
      moveTier(bonus, index, delta) { moveItem(bonus.tiers, index, delta); },

      /** Inserted/duplicated tiers start from the row clicked, not the last one -- more useful
       * when there are several tiers and you are working in the middle of the list. */
      insertTier(bonus, index) {
        const ref = bonus.tiers[index];
        bonus.tiers.splice(index + 1, 0, {
          set: ref?.set ?? this.setIds[0] ?? '',
          atLeast: (ref?.atLeast ?? 0) + 1,
          stats: [],
        });
      },

      duplicateTier(bonus, index) {
        const tier = bonus.tiers[index];
        bonus.tiers.splice(index + 1, 0, { ...tier, stats: tier.stats.map((s) => ({ ...s })) });
      },

      /** New variant starts unconditional -- the common case is one role-gated variant after
       * another, each edited via the same condition tree as a top-level bonus. */
      addVariant(bonus) { bonus.variants.push(api().newVariant()); },
      removeVariant(bonus, index) { bonus.variants.splice(index, 1); },
      insertVariant(bonus, index) { bonus.variants.splice(index + 1, 0, api().newVariant()); },

      duplicateVariant(bonus, index) {
        const variant = bonus.variants[index];
        bonus.variants.splice(index + 1, 0, {
          ...api().newVariant(),
          conditions: variant.conditions.map(cd().cloneRow),
          stats: variant.stats.map((s) => ({ ...s })),
        });
      },

      /** Variants are matched in order, first win -- reordering changes which one applies. */
      moveVariant(bonus, index, delta) { moveItem(bonus.variants, index, delta); },

      setPayload(bonus, payload) {
        if (bonus.payload === payload) return;
        bonus.payload = payload;
        if (payload === 'tiers' && !bonus.tiers.length) this.addTier(bonus);
        if (payload === 'variants' && !bonus.variants.length) this.addVariant(bonus);
      },
    },

    template: `
      <div>
        <div v-for="(bonus, bIndex) in rows" :key="bonus.uid" class="bonus-edit">
          <div class="bonus-edit-head">
            <label class="field"><span class="field-label">Name</span>
              <input class="bonus-name" type="text" v-model="bonus.name"
                     placeholder="friendly name shown in tooltips"></label>
            <label class="field"><span class="field-label">Id</span>
              <span class="bonus-id-row">
                <input class="bonus-id" type="text" v-model="bonus.id" :placeholder="idPlaceholder">
                <IconButton icon="wand-sparkles" title="Generate id from name" @click="generateId(bonus)" />
              </span>
            </label>
            <button type="button" class="link" @click="toggleJson(bonus)">
              {{ bonus.mode === 'json' ? 'use the form' : 'edit as JSON' }}
            </button>
            <span class="spacer"></span>
            <button type="button" class="link" :disabled="bIndex === 0"
                    @click="moveBonus(bIndex, -1)">move up</button>
            <button type="button" class="link" :disabled="bIndex === rows.length - 1"
                    @click="moveBonus(bIndex, 1)">move down</button>
            <button type="button" class="link" @click="duplicateBonus(bIndex)">duplicate</button>
            <button type="button" class="link" @click="insertBonus(bIndex)">insert below</button>
            <button type="button" class="link" @click="removeBonus(bIndex)">remove</button>
          </div>

          <textarea v-if="bonus.mode === 'json'" class="code" rows="8" v-model="bonus.json"></textarea>

          <template v-else>
            <div class="sub-section">Active when</div>
            <ConditionRows :rows="bonus.conditions" :depth="0" :set-ids="setIds" />

            <div class="sub-section">
              Grants
              <div class="seg">
                <button type="button" class="seg-btn" :class="{ 'is-on': bonus.payload === 'flat' }"
                        @click="setPayload(bonus, 'flat')">the same always</button>
                <button type="button" class="seg-btn" :class="{ 'is-on': bonus.payload === 'tiers' }"
                        @click="setPayload(bonus, 'tiers')">tiered by set pieces</button>
                <button type="button" class="seg-btn" :class="{ 'is-on': bonus.payload === 'variants' }"
                        @click="setPayload(bonus, 'variants')">varies by condition</button>
              </div>
            </div>

            <!-- flat payload -->
            <template v-if="bonus.payload === 'flat'">
              <div v-for="(stat, sIndex) in bonus.stats" :key="sIndex" class="stat-row">
                <IconButton icon="plus" title="Add stat" @click="addStat(bonus.stats)" />
                <IconButton icon="trash" title="Remove stat" @click="removeStat(bonus.stats, sIndex)" />
                <ComboBox class="combo--stat" :model-value="stat.key" :options="statComboOptions"
                          placeholder="— pick a stat —" @update:model-value="v => stat.key = v" />
                <PercentInput v-if="isPercent(stat.key)" v-model="stat.value" />
                <input v-else type="number" step="any" v-model.number="stat.value">
              </div>
              <div v-if="!bonus.stats.length" class="stat-row">
                <IconButton  icon="plus"
                            title="Add stat" @click="addStat(bonus.stats)" />
              </div>
            </template>

            <!-- tiered payload -->
            <template v-else-if="bonus.payload === 'tiers'">
              <p class="hint">
                The highest matching tier wins and <strong>replaces</strong> the lower ones —
                each tier's stats are the total at that piece count, not an extra on top.
              </p>
              <div v-for="(tier, tIndex) in bonus.tiers" :key="tIndex" class="tier">
                <div class="tier-head">
                  <IconButton icon="arrow-up" title="Move tier up" :disabled="tIndex === 0"
                              @click="moveTier(bonus, tIndex, -1)" />
                  <IconButton icon="arrow-down" title="Move tier down" :disabled="tIndex === bonus.tiers.length - 1"
                              @click="moveTier(bonus, tIndex, 1)" />
                  <IconButton icon="copy" title="Duplicate tier" @click="duplicateTier(bonus, tIndex)" />
                  <IconButton icon="circle-plus" title="Insert tier" @click="insertTier(bonus, tIndex)" />
                  <IconButton icon="trash" title="Remove tier" @click="removeTier(bonus, tIndex)" />
                  <ComboBox class="combo--set" :model-value="tier.set" :options="setComboOptions"
                            placeholder="— set —" @update:model-value="v => tier.set = v" />
                  <input type="number" min="1" v-model.number="tier.atLeast" class="tier-pieces">
                  <span class="hint">piece(s) or more</span>
                </div>
                <div v-for="(stat, sIndex) in tier.stats" :key="sIndex" class="stat-row">
                  <IconButton icon="plus" title="Add stat" @click="addStat(tier.stats)" />
                  <IconButton icon="trash" title="Remove stat" @click="removeStat(tier.stats, sIndex)" />
                  <ComboBox class="combo--stat" :model-value="stat.key" :options="statComboOptions"
                            placeholder="— pick a stat —" @update:model-value="v => stat.key = v" />
                  <PercentInput v-if="isPercent(stat.key)" v-model="stat.value" />
                  <input v-else type="number" step="any" v-model.number="stat.value">
                </div>
                <div v-if="!tier.stats.length" class="cond-add">
                  <IconButton v-if="!tier.stats.length" icon="plus" title="Add stat"
                              @click="addStat(tier.stats)" />
                </div>
              </div>
              <IconButton v-if="!bonus.tiers.length" icon="circle-plus" title="Add tier" @click="addTier(bonus)" />
            </template>

            <!-- variant payload -->
            <template v-else>
              <p class="hint">
                The first variant whose own condition matches wins -- order them most-specific
                first. Each variant's payload replaces the others, it does not add to them.
              </p>
              <div v-for="(variant, vIndex) in bonus.variants" :key="variant.uid" class="tier">
                <div class="tier-head">
                  <span class="hint">Variant {{ vIndex + 1 }}</span>
                  <span class="spacer"></span>
                  <button type="button" class="link" :disabled="vIndex === 0"
                          @click="moveVariant(bonus, vIndex, -1)">move up</button>
                  <button type="button" class="link" :disabled="vIndex === bonus.variants.length - 1"
                          @click="moveVariant(bonus, vIndex, 1)">move down</button>
                  <button type="button" class="link" @click="duplicateVariant(bonus, vIndex)">duplicate</button>
                  <button type="button" class="link" @click="insertVariant(bonus, vIndex)">insert below</button>
                  <button type="button" class="link" @click="removeVariant(bonus, vIndex)">remove variant</button>
                </div>
                <div class="sub-section">When</div>
                <ConditionRows :rows="variant.conditions" :depth="0" :set-ids="setIds" />
                <div class="sub-section">
                  Grants
                </div>
                <div v-for="(stat, sIndex) in variant.stats" :key="sIndex" class="stat-row">
                  <IconButton icon="plus" title="Add stat" @click="addStat(variant.stats)" />
                  <IconButton icon="trash" title="Remove stat" @click="removeStat(variant.stats, sIndex)" />
                  <ComboBox class="combo--stat" :model-value="stat.key" :options="statComboOptions"
                            placeholder="— pick a stat —" @update:model-value="v => stat.key = v" />
                  <PercentInput v-if="isPercent(stat.key)" v-model="stat.value" />
                  <input v-else type="number" step="any" v-model.number="stat.value">
                </div>
                <div v-if="!variant.stats.length" class="stat-row">
                  <IconButton icon="plus" title="Add stat"
                                                @click="addStat(variant.stats)" />
                </div>
              </div>
              <button type="button" class="link" @click="addVariant(bonus)">+ add variant</button>
            </template>

            <!-- stacking -->
            <div class="sub-section">Stacking</div>
            <div class="cond-row">
              <ComboBox class="combo--stacking" :model-value="bonus.stacking" :options="stackingOptions"
                        @update:model-value="v => bonus.stacking = v" />
              <template v-if="bonus.stacking === 'perSource'">
                <label class="field"><span class="field-label">Max stacks</span>
                  <input type="number" min="0" class="tier-pieces" v-model.number="bonus.maxStacks"></label>
                <span class="hint">maximum stacks (blank = no limit)</span>
              </template>
            </div>

            <div class="sub-section">Suppresses these bonuses</div>
            <TokenInput v-model="bonus.excludes" :options="bonusIds"
                        placeholder="bonus id to suppress…" />
          </template>
        </div>
      </div>
    `,
  };
})();
