// Editor for a bonus set's list of grants.
//
// A grant is anonymous -- no `id`/`name` of its own, since a set now resolves as one unit (its
// final stats are the sum of every active grant) and only the *set* needs to be addressable.
// What the form covers structurally: the condition tree (leaves plus `all`/`any`/`not`, see
// condition-rows.js), a flat stat payload, a *tiered* payload keyed on set pieces, and a
// *variants* payload (first matching condition wins). Only conditions nested deeper than
// `conditionDraft.MAX_DEPTH`, unrecognized condition keys, complex tiers, or a grant using both
// `tiers` and `variants` fall through to the JSON escape hatch -- the editor never silently
// flattens a structure it has no widget for.
//
// Stacking/`excludes` are a *set*-level property now (one grant among several shouldn't imply
// the whole bonus stacks), so they're edited once by the caller (`bonus-set-form.js`/
// `bonus-groups.js`), not per row here.
//
// The draft <-> grant conversion lives on `window.NW.bonusDraft` so item-form and set-bonuses
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
  const needsJson = (grant) => Boolean(
    !cd().whenIsRepresentable(grant.when)
    || (grant.tiers && !tiersAreSimple(grant.tiers))
    || (grant.variants && (grant.tiers || !variantsAreSimple(grant.variants))),
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

  function toDraft(grant = {}) {
    const json = needsJson(grant);
    return {
      uid: `b${Math.random().toString(36).slice(2, 8)}`,
      mode: json ? 'json' : 'simple',
      json: JSON.stringify(grant, null, 2),
      conditions: json ? [] : cd().whenToRows(grant.when),
      payload: grant.variants ? 'variants' : (grant.tiers ? 'tiers' : 'flat'),
      stats: json ? [] : statRows(grant.stats),
      tiers: json ? [] : (grant.tiers ?? []).map((tier) => ({
        set: tier.pieces?.set ?? '',
        atLeast: tier.pieces?.atLeast ?? 1,
        stats: statRows(tier.stats),
      })),
      variants: json ? [] : (grant.variants ?? []).map((variant) => ({
        ...newVariant(),
        conditions: cd().whenToRows(variant.when),
        stats: statRows(variant.stats),
      })),
    };
  }

  /** Throws on unparseable JSON so the caller can report it rather than dropping the grant. */
  function toGrant(draft) {
    if (draft.mode === 'json') return JSON.parse(draft.json);

    const out = {};
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

    return out;
  }

  /** Assembles a set-level draft (id/name/grants plus the set-level stacking/excludes fields)
   * back into the JSON shape, the same "only include if present" convention `toGrant` used to
   * apply per-effect -- shared by `bonus-set-form.js` and `bonus-groups.js` so the two editing
   * surfaces can't drift on what counts as "present". Throws if any grant is unparseable JSON. */
  function toSet(draft) {
    const grants = draft.grants.map((g) => toGrant(g));
    const out = { id: draft.id.trim(), name: draft.name.trim() || draft.id.trim(), grants };
    if (draft.stacking) out.stacking = draft.stacking;
    if (draft.maxStacks) out.maxStacks = Number(draft.maxStacks);
    if (draft.excludes?.length) out.excludes = [...draft.excludes];
    return out;
  }

  /** Deep clone, with a fresh uid so the copy does not collide with the original on save. */
  function duplicateDraft(draft) {
    return {
      ...draft,
      uid: `b${Math.random().toString(36).slice(2, 8)}`,
      conditions: draft.conditions.map(cd().cloneRow),
      stats: draft.stats.map((s) => ({ ...s })),
      tiers: draft.tiers.map((tier) => ({ ...tier, stats: tier.stats.map((s) => ({ ...s })) })),
      variants: draft.variants.map((variant) => ({
        ...newVariant(),
        conditions: variant.conditions.map(cd().cloneRow),
        stats: variant.stats.map((s) => ({ ...s })),
      })),
    };
  }

  return { needsJson, toDraft, toGrant, toSet, duplicateDraft, statRows, rowsToStats, newVariant };
})();

window.NW.components.BonusRows = (() => {
  'use strict';

  const api = () => window.NW.bonusDraft;
  const cd = () => window.NW.conditionDraft;

  /** Shared by every reorderable list here (grants, tiers, variants). */
  const moveItem = (list, index, delta) => {
    const to = index + delta;
    if (to < 0 || to >= list.length) return;
    const [item] = list.splice(index, 1);
    list.splice(to, 0, item);
  };

  return {
    name: 'BonusRows',

    components: {
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
    },

    methods: {
      isPercent: (key) => window.NW.format.isPercentKind(window.NW.format.kindOf(key)),
      focusNextStat(event) { window.NW.statRowNav.focusNextCombo(event); },

      addGrant() { this.rows.push(api().toDraft({ when: {}, stats: {} })); },
      removeGrant(index) { this.rows.splice(index, 1); },
      insertGrant(index) { this.rows.splice(index + 1, 0, api().toDraft({ when: {}, stats: {} })); },
      duplicateGrant(index) { this.rows.splice(index + 1, 0, api().duplicateDraft(this.rows[index])); },
      moveGrant(index, delta) { moveItem(this.rows, index, delta); },

      toggleJson(grant) {
        if (grant.mode === 'simple') {
          grant.json = JSON.stringify(api().toGrant(grant), null, 2);
          grant.mode = 'json';
          return;
        }
        try {
          const parsed = JSON.parse(grant.json);
          if (api().needsJson(parsed)) {
            this.$emit('error', 'That grant is too complex for the form (an unrecognized '
              + 'condition, tiers combined with variants, or conditions nested deeper than '
              + `${window.NW.conditionDraft.MAX_DEPTH} levels). Keeping it as JSON.`);
            return;
          }
          Object.assign(grant, api().toDraft(parsed), { uid: grant.uid, mode: 'simple' });
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
      addTier(grant) {
        const last = grant.tiers[grant.tiers.length - 1];
        grant.tiers.push({
          set: last?.set ?? this.setIds[0] ?? '',
          atLeast: (last?.atLeast ?? 0) + 1,
          stats: last ? last.stats.map((s) => ({ ...s })) : [],
        });
      },

      removeTier(grant, index) { grant.tiers.splice(index, 1); },
      moveTier(grant, index, delta) { moveItem(grant.tiers, index, delta); },

      /** Inserted/duplicated tiers start from the row clicked, not the last one -- more useful
       * when there are several tiers and you are working in the middle of the list. */
      insertTier(grant, index) {
        const ref = grant.tiers[index];
        grant.tiers.splice(index + 1, 0, {
          set: ref?.set ?? this.setIds[0] ?? '',
          atLeast: (ref?.atLeast ?? 0) + 1,
          stats: [],
        });
      },

      duplicateTier(grant, index) {
        const tier = grant.tiers[index];
        grant.tiers.splice(index + 1, 0, { ...tier, stats: tier.stats.map((s) => ({ ...s })) });
      },

      /** New variant starts unconditional -- the common case is one role-gated variant after
       * another, each edited via the same condition tree as a top-level grant. */
      addVariant(grant) { grant.variants.push(api().newVariant()); },
      removeVariant(grant, index) { grant.variants.splice(index, 1); },
      insertVariant(grant, index) { grant.variants.splice(index + 1, 0, api().newVariant()); },

      duplicateVariant(grant, index) {
        const variant = grant.variants[index];
        grant.variants.splice(index + 1, 0, {
          ...api().newVariant(),
          conditions: variant.conditions.map(cd().cloneRow),
          stats: variant.stats.map((s) => ({ ...s })),
        });
      },

      /** Variants are matched in order, first win -- reordering changes which one applies. */
      moveVariant(grant, index, delta) { moveItem(grant.variants, index, delta); },

      setPayload(grant, payload) {
        if (grant.payload === payload) return;
        grant.payload = payload;
        if (payload === 'tiers' && !grant.tiers.length) this.addTier(grant);
        if (payload === 'variants' && !grant.variants.length) this.addVariant(grant);
      },
    },

    template: `
      <div>
        <div v-for="(grant, gIndex) in rows" :key="grant.uid" class="bonus-edit">
          <div class="bonus-edit-head">
            <span class="hint">Grant {{ gIndex + 1 }}</span>
            <button type="button" class="link" @click="toggleJson(grant)">
              {{ grant.mode === 'json' ? 'use the form' : 'edit as JSON' }}
            </button>
            <span class="spacer"></span>
            <button type="button" class="link" :disabled="gIndex === 0"
                    @click="moveGrant(gIndex, -1)">move up</button>
            <button type="button" class="link" :disabled="gIndex === rows.length - 1"
                    @click="moveGrant(gIndex, 1)">move down</button>
            <button type="button" class="link" @click="duplicateGrant(gIndex)">duplicate</button>
            <button type="button" class="link" @click="insertGrant(gIndex)">insert below</button>
            <button type="button" class="link" @click="removeGrant(gIndex)">remove</button>
          </div>

          <textarea v-if="grant.mode === 'json'" class="code" rows="8" v-model="grant.json"></textarea>

          <template v-else>
            <div class="sub-section">Active when</div>
            <ConditionRows :rows="grant.conditions" :depth="0" :set-ids="setIds" />

            <div class="sub-section">
              Payload
              <div class="seg">
                <button type="button" class="seg-btn" :class="{ 'is-on': grant.payload === 'flat' }"
                        @click="setPayload(grant, 'flat')">the same always</button>
                <button type="button" class="seg-btn" :class="{ 'is-on': grant.payload === 'tiers' }"
                        @click="setPayload(grant, 'tiers')">tiered by set pieces</button>
                <button type="button" class="seg-btn" :class="{ 'is-on': grant.payload === 'variants' }"
                        @click="setPayload(grant, 'variants')">varies by condition</button>
              </div>
            </div>

            <!-- flat payload -->
            <template v-if="grant.payload === 'flat'">
              <div v-for="(stat, sIndex) in grant.stats" :key="sIndex" class="stat-row">
                <IconButton icon="plus" title="Add stat" @click="addStat(grant.stats)" />
                <IconButton icon="trash" title="Remove stat" @click="removeStat(grant.stats, sIndex)" />
                <ComboBox class="combo--stat" :model-value="stat.key" :options="statComboOptions"
                          placeholder="— pick a stat —" @update:model-value="v => stat.key = v" />
                <PercentInput v-if="isPercent(stat.key)" v-model="stat.value" @keydown="focusNextStat" />
                <input v-else type="number" step="any" v-model.number="stat.value" @keydown="focusNextStat">
              </div>
              <div v-if="!grant.stats.length" class="stat-row">
                <IconButton  icon="plus"
                            title="Add stat" @click="addStat(grant.stats)" />
              </div>
            </template>

            <!-- tiered payload -->
            <template v-else-if="grant.payload === 'tiers'">
              <p class="hint">
                The highest matching tier wins and <strong>replaces</strong> the lower ones —
                each tier's stats are the total at that piece count, not an extra on top.
              </p>
              <div v-for="(tier, tIndex) in grant.tiers" :key="tIndex" class="tier">
                <div class="tier-head">
                  <IconButton icon="arrow-up" title="Move tier up" :disabled="tIndex === 0"
                              @click="moveTier(grant, tIndex, -1)" />
                  <IconButton icon="arrow-down" title="Move tier down" :disabled="tIndex === grant.tiers.length - 1"
                              @click="moveTier(grant, tIndex, 1)" />
                  <IconButton icon="copy" title="Duplicate tier" @click="duplicateTier(grant, tIndex)" />
                  <IconButton icon="circle-plus" title="Insert tier" @click="insertTier(grant, tIndex)" />
                  <IconButton icon="trash" title="Remove tier" @click="removeTier(grant, tIndex)" />
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
                  <PercentInput v-if="isPercent(stat.key)" v-model="stat.value" @keydown="focusNextStat" />
                  <input v-else type="number" step="any" v-model.number="stat.value" @keydown="focusNextStat">
                </div>
                <div v-if="!tier.stats.length" class="cond-add">
                  <IconButton v-if="!tier.stats.length" icon="plus" title="Add stat"
                              @click="addStat(tier.stats)" />
                </div>
              </div>
              <IconButton v-if="!grant.tiers.length" icon="circle-plus" title="Add tier" @click="addTier(grant)" />
            </template>

            <!-- variant payload -->
            <template v-else>
              <p class="hint">
                The first variant whose own condition matches wins -- order them most-specific
                first. Each variant's payload replaces the others, it does not add to them.
              </p>
              <div v-for="(variant, vIndex) in grant.variants" :key="variant.uid" class="tier">
                <div class="tier-head">
                  <span class="hint">Variant {{ vIndex + 1 }}</span>
                  <span class="spacer"></span>
                  <button type="button" class="link" :disabled="vIndex === 0"
                          @click="moveVariant(grant, vIndex, -1)">move up</button>
                  <button type="button" class="link" :disabled="vIndex === grant.variants.length - 1"
                          @click="moveVariant(grant, vIndex, 1)">move down</button>
                  <button type="button" class="link" @click="duplicateVariant(grant, vIndex)">duplicate</button>
                  <button type="button" class="link" @click="insertVariant(grant, vIndex)">insert below</button>
                  <button type="button" class="link" @click="removeVariant(grant, vIndex)">remove variant</button>
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
                  <PercentInput v-if="isPercent(stat.key)" v-model="stat.value" @keydown="focusNextStat" />
                  <input v-else type="number" step="any" v-model.number="stat.value" @keydown="focusNextStat">
                </div>
                <div v-if="!variant.stats.length" class="stat-row">
                  <IconButton icon="plus" title="Add stat"
                                                @click="addStat(variant.stats)" />
                </div>
              </div>
              <button type="button" class="link" @click="addVariant(grant)">+ add variant</button>
            </template>

          </template>
        </div>
      </div>
    `,
  };
})();
