<script setup lang="ts">
// Editor for a bonus set's list of grants. See bonus-draft.ts's header for the structural
// notes (anonymous grants, flat/tiered/variants payloads, the JSON escape hatch).
import { computed } from 'vue';
import PercentInput from './PercentInput.vue';
import ComboBox from './ComboBox.vue';
import ConditionRows from './ConditionRows.vue';
import IconButton from './IconButton.vue';
import { NW_SCHEMA } from '../data';
import { isPercentKind, kindOf } from '../format';
import { focusNextCombo } from '../stat-row-nav';
import { MAX_DEPTH, cloneRow } from '../condition-draft';
import * as bonusDraft from '../bonus-draft';
import type { GrantDraft, StatRow } from '../bonus-draft';

const props = withDefaults(defineProps<{
  // Mutated in place. The parent owns the draft array and re-reads it on save; passing a
  // reactive array down is the least ceremonious way to edit a list of sub-objects.
  rows: GrantDraft[];
  setIds?: string[];
  tags?: string[];
}>(), {
  setIds: () => [],
  tags: () => [],
});

const emit = defineEmits<{ error: [message: string] }>();

/** Shared by every reorderable list here (grants, tiers, variants). */
const moveItem = <T,>(list: T[], index: number, delta: number) => {
  const to = index + delta;
  if (to < 0 || to >= list.length) return;
  const [item] = list.splice(index, 1);
  list.splice(to, 0, item);
};

const statOptions = NW_SCHEMA.stats;
const statComboOptions = statOptions.map((s) => ({ value: s.key, label: `${s.label} (${s.key})` }));
const setComboOptions = computed(() => props.setIds.map((s) => ({ value: s, label: s })));

const isPercent = (key: string) => isPercentKind(kindOf(key));
function focusNextStat(event: KeyboardEvent) { focusNextCombo(event); }

function addGrant() { props.rows.push(bonusDraft.toDraft({ when: {}, stats: {} })); }
function removeGrant(index: number) { props.rows.splice(index, 1); }
function insertGrant(index: number) { props.rows.splice(index + 1, 0, bonusDraft.toDraft({ when: {}, stats: {} })); }
function duplicateGrant(index: number) { props.rows.splice(index + 1, 0, bonusDraft.duplicateDraft(props.rows[index])); }
function moveGrant(index: number, delta: number) { moveItem(props.rows, index, delta); }

function toggleJson(grant: GrantDraft) {
  if (grant.mode === 'simple') {
    grant.json = JSON.stringify(bonusDraft.toGrant(grant), null, 2);
    grant.mode = 'json';
    return;
  }
  try {
    const parsed = JSON.parse(grant.json);
    if (bonusDraft.needsJson(parsed)) {
      emit('error', 'That grant is too complex for the form (an unrecognized '
        + 'condition, tiers combined with variants, or conditions nested deeper than '
        + `${MAX_DEPTH} levels). Keeping it as JSON.`);
      return;
    }
    Object.assign(grant, bonusDraft.toDraft(parsed), { uid: grant.uid, mode: 'simple' });
    emit('error', '');
  } catch (error: any) {
    emit('error', `Cannot switch to the form: ${error.message}`);
  }
}

function addStat(rows: StatRow[]) { rows.push({ key: '', value: 0 }); }
function removeStat(rows: StatRow[], index: number) { rows.splice(index, 1); }

/**
 * Tier payloads are absolute, not cumulative: the highest matching threshold wins and
 * replaces the lower one (bonus.ts). A new tier therefore starts from a copy of the
 * previous one, which is nearly always the intent.
 */
function addTier(grant: GrantDraft) {
  const last = grant.tiers[grant.tiers.length - 1];
  grant.tiers.push({
    set: last?.set ?? props.setIds[0] ?? '',
    atLeast: (last?.atLeast ?? 0) + 1,
    stats: last ? last.stats.map((s) => ({ ...s })) : [],
  });
}

function removeTier(grant: GrantDraft, index: number) { grant.tiers.splice(index, 1); }
function moveTier(grant: GrantDraft, index: number, delta: number) { moveItem(grant.tiers, index, delta); }

/** Inserted/duplicated tiers start from the row clicked, not the last one -- more useful
 * when there are several tiers and you are working in the middle of the list. */
function insertTier(grant: GrantDraft, index: number) {
  const ref = grant.tiers[index];
  grant.tiers.splice(index + 1, 0, {
    set: ref?.set ?? props.setIds[0] ?? '',
    atLeast: (ref?.atLeast ?? 0) + 1,
    stats: [],
  });
}

function duplicateTier(grant: GrantDraft, index: number) {
  const tier = grant.tiers[index];
  grant.tiers.splice(index + 1, 0, { ...tier, stats: tier.stats.map((s) => ({ ...s })) });
}

/** New variant starts unconditional -- the common case is one role-gated variant after
 * another, each edited via the same condition tree as a top-level grant. */
function addVariant(grant: GrantDraft) { grant.variants.push(bonusDraft.newVariant()); }
function removeVariant(grant: GrantDraft, index: number) { grant.variants.splice(index, 1); }
function insertVariant(grant: GrantDraft, index: number) { grant.variants.splice(index + 1, 0, bonusDraft.newVariant()); }

function duplicateVariant(grant: GrantDraft, index: number) {
  const variant = grant.variants[index];
  grant.variants.splice(index + 1, 0, {
    ...bonusDraft.newVariant(),
    conditions: variant.conditions.map(cloneRow),
    stats: variant.stats.map((s) => ({ ...s })),
  });
}

/** Variants are matched in order, first win -- reordering changes which one applies. */
function moveVariant(grant: GrantDraft, index: number, delta: number) { moveItem(grant.variants, index, delta); }

function setPayload(grant: GrantDraft, payload: GrantDraft['payload']) {
  if (grant.payload === payload) return;
  grant.payload = payload;
  if (payload === 'tiers' && !grant.tiers.length) addTier(grant);
  if (payload === 'variants' && !grant.variants.length) addVariant(grant);
}
</script>

<template>
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
</template>
