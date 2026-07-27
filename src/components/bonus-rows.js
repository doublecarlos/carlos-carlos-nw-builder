// Editor for a list of bonuses.
//
// Item bonuses and set effects turned out to be the same editing problem: both are
// `{ id, when, stats|tiers }`, so one component serves both and the set editor reuses it.
//
// What the form covers structurally: the leaf conditions, a flat stat payload, a *tiered*
// payload keyed on set pieces, and the stacking rules (`stacking`, `maxStacks`, `excludes`).
// Only `variants` and nested `any`/`all`/`not` fall through to the JSON escape hatch, and a
// bonus using them opens in JSON mode automatically -- the editor never silently flattens a
// structure it has no widget for.
//
// The draft <-> bonus conversion lives on `window.NW.bonusDraft` so item-form and set-bonuses
// can build and read drafts without importing the component.

window.NW = window.NW ?? {};
window.NW.components = window.NW.components ?? {};

window.NW.bonusDraft = (() => {
  'use strict';

  const SIMPLE_CONDITIONS = ['toggle', 'role', 'class', 'combatType', 'location', 'damageType',
    'duration', 'pieces', 'equipped'];

  // Exactly what the engine reads off a tier (bonus.js `evaluateBonus`). Anything else on a
  // tier would be dropped by the form, so its presence forces JSON mode instead.
  const TIER_KEYS = new Set(['pieces', 'stats']);
  const PIECES_KEYS = new Set(['set', 'atLeast']);

  const fromCsv = (text) => String(text ?? '').split(',').map((s) => s.trim()).filter(Boolean);

  const tiersAreSimple = (tiers) => (tiers ?? []).every((tier) => (
    Object.keys(tier).every((key) => TIER_KEYS.has(key))
    && tier.pieces && typeof tier.pieces === 'object'
    && Object.keys(tier.pieces).every((key) => PIECES_KEYS.has(key))
  ));

  /** Structures the form cannot represent without losing something. */
  const needsJson = (bonus) => Boolean(
    bonus.variants
    || Object.keys(bonus.when ?? {}).some((key) => !SIMPLE_CONDITIONS.includes(key))
    || (bonus.tiers && !tiersAreSimple(bonus.tiers)),
  );

  function conditionRows(when) {
    return Object.entries(when ?? {}).map(([type, spec]) => {
      if (type === 'duration') {
        const range = typeof spec === 'number' ? { atLeast: spec } : (spec ?? {});
        return { type, atLeast: range.atLeast ?? null, below: range.below ?? null };
      }
      if (type === 'pieces') return { type, set: spec?.set ?? '', atLeast: spec?.atLeast ?? 1 };
      if (type === 'equipped') {
        return { type, tag: spec?.tag ?? '', item: spec?.item ?? '', atLeast: spec?.atLeast ?? 1 };
      }
      return { type, value: Array.isArray(spec) ? spec.join(', ') : String(spec ?? '') };
    });
  }

  function rowsToWhen(rows) {
    const when = {};
    for (const row of rows) {
      if (row.type === 'duration') {
        const range = {};
        if (row.atLeast != null && row.atLeast !== '') range.atLeast = Number(row.atLeast);
        if (row.below != null && row.below !== '') range.below = Number(row.below);
        if (Object.keys(range).length) when.duration = range;
      } else if (row.type === 'pieces') {
        if (row.set) when.pieces = { set: row.set, atLeast: Number(row.atLeast) || 1 };
      } else if (row.type === 'equipped') {
        if (row.tag) when.equipped = { tag: row.tag, atLeast: Number(row.atLeast) || 1 };
        else if (row.item) when.equipped = { item: row.item, atLeast: Number(row.atLeast) || 1 };
      } else {
        const values = fromCsv(row.value);
        if (values.length === 1) when[row.type] = values[0];
        else if (values.length > 1) when[row.type] = values;
      }
    }
    return when;
  }

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

  function toDraft(bonus = {}) {
    const json = needsJson(bonus);
    return {
      uid: `b${Math.random().toString(36).slice(2, 8)}`,
      id: bonus.id ?? '',
      mode: json ? 'json' : 'simple',
      json: JSON.stringify(bonus, null, 2),
      conditions: json ? [] : conditionRows(bonus.when),
      payload: bonus.tiers ? 'tiers' : 'flat',
      stats: json ? [] : statRows(bonus.stats),
      tiers: json ? [] : (bonus.tiers ?? []).map((tier) => ({
        set: tier.pieces?.set ?? '',
        atLeast: tier.pieces?.atLeast ?? 1,
        stats: statRows(tier.stats),
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
    const when = rowsToWhen(draft.conditions);
    if (Object.keys(when).length) out.when = when;

    if (draft.payload === 'tiers') {
      out.tiers = draft.tiers.map((tier) => ({
        pieces: { set: tier.set, atLeast: Number(tier.atLeast) || 1 },
        stats: rowsToStats(tier.stats),
      }));
    } else {
      out.stats = rowsToStats(draft.stats);
    }

    if (draft.stacking) out.stacking = draft.stacking;
    if (draft.maxStacks) out.maxStacks = Number(draft.maxStacks);
    if (draft.excludes?.length) out.excludes = [...draft.excludes];

    return out;
  }

  return { SIMPLE_CONDITIONS, needsJson, conditionRows, rowsToWhen, toDraft, toBonus,
    statRows, rowsToStats };
})();

window.NW.components.BonusRows = (() => {
  'use strict';

  const api = () => window.NW.bonusDraft;

  return {
    name: 'BonusRows',

    components: {
      TokenInput: window.NW.components.TokenInput,
      PercentInput: window.NW.components.PercentInput,
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

    data: () => ({ simpleConditions: window.NW.bonusDraft.SIMPLE_CONDITIONS }),

    computed: {
      statOptions: () => window.NW_SCHEMA.stats,
    },

    methods: {
      isPercent: (key) => window.NW.format.isPercentKind(window.NW.format.kindOf(key)),

      addBonus() { this.rows.push(api().toDraft({ id: '', when: {}, stats: {} })); },
      removeBonus(index) { this.rows.splice(index, 1); },

      toggleJson(bonus) {
        if (bonus.mode === 'simple') {
          bonus.json = JSON.stringify(api().toBonus(bonus), null, 2);
          bonus.mode = 'json';
          return;
        }
        try {
          const parsed = JSON.parse(bonus.json);
          if (api().needsJson(parsed)) {
            this.$emit('error', 'That bonus uses variants or a nested condition, which the '
              + 'form cannot represent. Keeping it as JSON.');
            return;
          }
          Object.assign(bonus, api().toDraft(parsed), { uid: bonus.uid, mode: 'simple' });
          this.$emit('error', '');
        } catch (error) {
          this.$emit('error', `Cannot switch to the form: ${error.message}`);
        }
      },

      addCondition(bonus) { bonus.conditions.push({ type: 'toggle', value: '' }); },
      removeCondition(bonus, index) { bonus.conditions.splice(index, 1); },

      changeConditionType(row) {
        // Each predicate carries different fields; reset to the new shape's defaults.
        const type = row.type;
        Object.keys(row).forEach((key) => { if (key !== 'type') delete row[key]; });
        if (type === 'duration') { row.atLeast = null; row.below = null; } else if (type === 'pieces') { row.set = this.setIds[0] ?? ''; row.atLeast = 1; } else if (type === 'equipped') { row.tag = ''; row.item = ''; row.atLeast = 1; } else row.value = '';
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

      setPayload(bonus, payload) {
        if (bonus.payload === payload) return;
        bonus.payload = payload;
        if (payload === 'tiers' && !bonus.tiers.length) this.addTier(bonus);
      },

      optionsFor(type) {
        const context = window.NW_SCHEMA.context;
        if (type === 'toggle') return context.toggles;
        if (type === 'role') return context.roles;
        if (type === 'class') return context.classes;
        if (type === 'combatType') return context.combatTypes;
        if (type === 'location') return context.locations;
        if (type === 'damageType') return context.damageTypes;
        return [];
      },
    },

    template: `
      <div>
        <div v-for="(bonus, bIndex) in rows" :key="bonus.uid" class="bonus-edit">
          <div class="bonus-edit-head">
            <input class="bonus-id" type="text" v-model="bonus.id" :placeholder="idPlaceholder">
            <button type="button" class="link" @click="toggleJson(bonus)">
              {{ bonus.mode === 'json' ? 'use the form' : 'edit as JSON' }}
            </button>
            <button type="button" class="link" @click="removeBonus(bIndex)">remove</button>
          </div>

          <textarea v-if="bonus.mode === 'json'" class="code" rows="8" v-model="bonus.json"></textarea>

          <template v-else>
            <div class="sub-section">
              Active when
              <button type="button" class="link" @click="addCondition(bonus)">+ add</button>
              <span v-if="!bonus.conditions.length" class="hint">always</span>
            </div>
            <div v-for="(row, cIndex) in bonus.conditions" :key="cIndex" class="cond-row">
              <select v-model="row.type" @change="changeConditionType(row)">
                <option v-for="t in simpleConditions" :key="t" :value="t">{{ t }}</option>
              </select>

              <template v-if="row.type === 'duration'">
                <label class="field"><span class="field-label">At least (s)</span>
                  <input type="number" v-model.number="row.atLeast"></label>
                <label class="field"><span class="field-label">Below (s)</span>
                  <input type="number" v-model.number="row.below"></label>
              </template>
              <template v-else-if="row.type === 'pieces'">
                <select v-model="row.set">
                  <option value="">— set —</option>
                  <option v-for="s in setIds" :key="s" :value="s">{{ s }}</option>
                </select>
                <label class="field"><span class="field-label">Pieces</span>
                  <input type="number" min="1" v-model.number="row.atLeast"></label>
                <span class="hint">piece(s) equipped</span>
              </template>
              <template v-else-if="row.type === 'equipped'">
                <label class="field"><span class="field-label">Tag</span>
                  <input type="text" v-model="row.tag" list="nw-tags"></label>
                <label class="field"><span class="field-label">Or exact item name</span>
                  <input type="text" v-model="row.item"></label>
                <label class="field"><span class="field-label">Count</span>
                  <input type="number" v-model.number="row.atLeast"></label>
              </template>
              <template v-else>
                <select v-if="optionsFor(row.type).length" v-model="row.value">
                  <option v-for="o in optionsFor(row.type)" :key="o" :value="o">{{ o }}</option>
                </select>
                <input v-else type="text" v-model="row.value">
              </template>

              <button type="button" class="link" @click="removeCondition(bonus, cIndex)">remove</button>
            </div>

            <div class="sub-section">
              Grants
              <div class="seg">
                <button type="button" class="seg-btn" :class="{ 'is-on': bonus.payload === 'flat' }"
                        @click="setPayload(bonus, 'flat')">the same always</button>
                <button type="button" class="seg-btn" :class="{ 'is-on': bonus.payload === 'tiers' }"
                        @click="setPayload(bonus, 'tiers')">tiered by set pieces</button>
              </div>
              <button v-if="bonus.payload === 'flat'" type="button" class="link"
                      @click="addStat(bonus.stats)">+ add stat</button>
            </div>

            <!-- flat payload -->
            <template v-if="bonus.payload === 'flat'">
              <div v-for="(stat, sIndex) in bonus.stats" :key="sIndex" class="stat-row">
                <select v-model="stat.key">
                  <option value="">— pick a stat —</option>
                  <option v-for="s in statOptions" :key="s.key" :value="s.key">
                    {{ s.label }} ({{ s.key }})
                  </option>
                </select>
                <PercentInput v-if="isPercent(stat.key)" v-model="stat.value" />
                <input v-else type="number" step="any" v-model.number="stat.value">
                <button type="button" class="link" @click="removeStat(bonus.stats, sIndex)">remove</button>
              </div>
            </template>

            <!-- tiered payload -->
            <template v-else>
              <p class="hint">
                The highest matching tier wins and <strong>replaces</strong> the lower ones —
                each tier's stats are the total at that piece count, not an extra on top.
              </p>
              <div v-for="(tier, tIndex) in bonus.tiers" :key="tIndex" class="tier">
                <div class="tier-head">
                  <select v-model="tier.set">
                    <option value="">— set —</option>
                    <option v-for="s in setIds" :key="s" :value="s">{{ s }}</option>
                  </select>
                  <input type="number" min="1" v-model.number="tier.atLeast" class="tier-pieces">
                  <span class="hint">piece(s) or more</span>
                  <span class="spacer"></span>
                  <button type="button" class="link" @click="addStat(tier.stats)">+ add stat</button>
                  <button type="button" class="link" @click="removeTier(bonus, tIndex)">remove tier</button>
                </div>
                <div v-for="(stat, sIndex) in tier.stats" :key="sIndex" class="stat-row">
                  <select v-model="stat.key">
                    <option value="">— pick a stat —</option>
                    <option v-for="s in statOptions" :key="s.key" :value="s.key">
                      {{ s.label }} ({{ s.key }})
                    </option>
                  </select>
                  <input type="number" step="any" v-model.number="stat.value">
                  <span class="hint">{{ stat.key && isPercent(stat.key) ? '0.09 = 9%' : '' }}</span>
                  <button type="button" class="link" @click="removeStat(tier.stats, sIndex)">remove</button>
                </div>
              </div>
              <button type="button" class="link" @click="addTier(bonus)">+ add tier</button>
            </template>

            <!-- stacking -->
            <div class="sub-section">Stacking</div>
            <div class="cond-row">
              <select v-model="bonus.stacking">
                <option value="">once, however many sources</option>
                <option value="perSource">once per contributing slot</option>
              </select>
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
