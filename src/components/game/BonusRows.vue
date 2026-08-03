<script setup lang="ts">
// Editor for a bonus set's list of grants. See stores/bonus-draft.ts for the structural
// notes (anonymous grants, flat/tiered/variants payloads, the JSON escape hatch).
//
// This component no longer emits a replaced `rows` array when a grant is edited. Instead,
// all mutations go through the `store` — a `BonusDraftStore` created in BonusSetForm that
// writes directly onto `draft.value.grants`. The store's `onChange()` is called after every
// mutation, which schedules an undo snapshot in BonusSetForm.

import { computed } from "vue";
import PercentInput from "../ui/PercentInput.vue";
import ComboBox from "../ui/ComboBox.vue";
import ConditionRows from "./ConditionRows.vue";
import IconButton from "../ui/IconButton.vue";
import { ArrowDown, ArrowUp, CirclePlus, Copy, Plus, Trash } from "@lucide/vue";
import BaseButton from "../ui/BaseButton.vue";
import FormSection from "../ui/FormSection.vue";
import { NW_SCHEMA } from "../../data/data";
import { isPercentKind, kindOf } from "../../lib/format";
import { focusNextCombo } from "../../lib/stat-row-nav";
import { BonusDraftStore } from "../../stores/bonus-draft";

const emit = defineEmits<{ error: [message: string] }>();

const props = withDefaults(
  defineProps<{
    store: BonusDraftStore;
    setIds?: string[];
    tags?: string[];
  }>(),
  { setIds: () => [], tags: () => [] },
);

const statOptions = NW_SCHEMA.stats;
const statComboOptions = statOptions.map((s) => ({
  value: s.key,
  label: `${s.label} (${s.key})`,
}));
const setComboOptions = computed(() =>
  props.store.setIds.map((s) => ({ value: s, label: s })),
);
const isPercent = (key: string) => isPercentKind(kindOf(key));

function focusNextStat(event: KeyboardEvent) {
  focusNextCombo(event);
}

// Guard against a grant being removed while an event handler is still firing.
function gs(index: number) {
  const s = props.store.grantStore(index);
  if (!s) throw new Error(`Grant index out of range: ${index}`);
  return s;
}

/** Toggle between simple/form and JSON editing for one grant. If the JSON is unparseable or
 * the structure is too complex for the form, emit an error from the component. */
function toggleJson(gIndex: number) {
  const s = props.store.grantStore(gIndex);
  if (!s) return;
  const result = s.toggleJson();
  if (result === 1) {
    // entered JSON mode — no error to emit
    return;
  }
  // result === -1: invalid JSON
  // result ===  0: entered simple/form mode  or  stayed JSON (too complex)
  if (s.grant.mode === "json") {
    emit(
      "error",
      "That grant is too complex for the form (an unrecognized " +
        "condition, tiers combined with variants, or conditions nested deeper than " +
        "5 levels). Keeping it as JSON.",
    );
  } else {
    emit("error", ""); // cleared any previous error
  }
}
</script>

<template>
  <div>
    <div
      v-for="(grant, gIndex) in props.store.grants"
      :key="grant.uid"
      class="mb-2 rounded-md border border-line bg-surface-2 p-2.5"
    >
      <!-- items-end, not items-center: these buttons have no label above them, so centering
           would float them against the taller labeled fields elsewhere in the form. -->
      <div class="flex flex-wrap items-end gap-2">
        <span class="text-sm text-muted">Grant {{ gIndex + 1 }}</span>
        <BaseButton variant="link" @click="toggleJson(gIndex)">
          {{ grant.mode === "json" ? "use the form" : "edit as JSON" }}
        </BaseButton>
        <span class="flex-1"></span>
        <IconButton
          title="Move grant up"
          :disabled="gIndex === 0"
          @click="props.store.moveGrant(gIndex, -1)"
        >
          <ArrowUp />
        </IconButton>
        <IconButton
          title="Move grant down"
          :disabled="gIndex === props.store.grants.length - 1"
          @click="props.store.moveGrant(gIndex, 1)"
        >
          <ArrowDown />
        </IconButton>
        <IconButton
          title="Duplicate grant"
          @click="props.store.duplicateGrant(gIndex)"
        >
          <Copy />
        </IconButton>
        <IconButton
          title="Insert grant below"
          @click="props.store.insertGrant(gIndex)"
        >
          <CirclePlus />
        </IconButton>
        <IconButton
          title="Remove grant"
          @click="props.store.removeGrant(gIndex)"
        >
          <Trash />
        </IconButton>
      </div>

      <textarea
        v-if="grant.mode === 'json'"
        v-model="grant.json"
        class="mt-1 w-full resize-y rounded-md border border-line bg-surface p-2 font-mono"
        rows="8"
      ></textarea>

      <template v-else>
        <FormSection sub>Active when</FormSection>
        <ConditionRows
          :rows="grant.conditions"
          :depth="0"
          :set-ids="props.store.setIds"
          @update="(updated) => props.store.setConditions(gIndex, updated)"
        />

        <FormSection sub>
          Payload
          <div class="inline-flex">
            <button
              type="button"
              class="border border-line px-2 py-0.5 text-sm first:rounded-l-md last:rounded-r-md last:border-l-0"
              :class="
                grant.payload === 'flat'
                  ? 'border-accent bg-accent-soft text-text'
                  : 'bg-surface text-muted'
              "
              @click="gs(gIndex).setPayload('flat')"
            >
              the same always
            </button>
            <button
              type="button"
              class="border border-line px-2 py-0.5 text-sm first:rounded-l-md last:rounded-r-md last:border-l-0"
              :class="
                grant.payload === 'tiers'
                  ? 'border-accent bg-accent-soft text-text'
                  : 'bg-surface text-muted'
              "
              @click="gs(gIndex).setPayload('tiers')"
            >
              tiered by set pieces
            </button>
            <button
              type="button"
              class="border border-line px-2 py-0.5 text-sm first:rounded-l-md last:rounded-r-md last:border-l-0"
              :class="
                grant.payload === 'variants'
                  ? 'border-accent bg-accent-soft text-text'
                  : 'bg-surface text-muted'
              "
              @click="gs(gIndex).setPayload('variants')"
            >
              varies by condition
            </button>
          </div>
        </FormSection>

        <!-- flat payload -->
        <template v-if="grant.payload === 'flat'">
          <div
            v-for="(stat, sIndex) in grant.stats"
            :key="sIndex"
            class="stat-row flex flex-wrap items-center gap-1.5 mb-1"
          >
            <IconButton title="Add stat" @click="gs(gIndex).addStat()"
              ><Plus
            /></IconButton>
            <IconButton
              title="Remove stat"
              @click="gs(gIndex).removeStat(sIndex)"
              ><Trash
            /></IconButton>
            <ComboBox
              class="combo--stat w-52"
              :model-value="stat.key"
              :options="statComboOptions"
              placeholder="— pick a stat —"
              @update:model-value="(v) => (stat.key = v)"
            />
            <PercentInput
              v-if="isPercent(stat.key)"
              v-model="stat.value"
              class="w-28"
              @keydown="focusNextStat"
            />
            <input
              v-else
              v-model.number="stat.value"
              class="w-28 rounded-md border border-line bg-surface px-1.5 py-0.5 text-right focus:outline-2 focus:-outline-offset-1 focus:outline-accent"
              type="number"
              step="any"
              @keydown="focusNextStat"
            />
          </div>
          <div
            v-if="!grant.stats.length"
            class="stat-row flex flex-wrap items-center gap-1.5 mb-1"
          >
            <IconButton title="Add stat" @click="gs(gIndex).addStat()"
              ><Plus
            /></IconButton>
          </div>
        </template>

        <!-- tiered payload -->
        <template v-else-if="grant.payload === 'tiers'">
          <p class="text-sm text-muted">
            The highest matching tier wins and <strong>replaces</strong> the
            lower ones — each tier's stats are the total at that piece count,
            not an extra on top.
          </p>
          <!-- Boxed, not just a rule on the left -- with several tiers stacked back to back a
               thin line alone isn't enough contrast to tell where one ends and the next
               begins. The parent is already `bg-surface-2`, so tiers go `bg-surface` to read
               as lighter cards sitting on top of it. -->
          <div
            v-for="(tier, tIndex) in grant.tiers"
            :key="tIndex"
            class="my-1.5 rounded-md border border-line border-l-4 border-l-accent bg-surface px-2.5 py-1.5"
          >
            <div class="mb-1 flex flex-wrap items-center gap-1.5">
              <IconButton
                title="Move tier up"
                :disabled="tIndex === 0"
                @click="gs(gIndex).moveTier(tIndex, -1)"
                ><ArrowUp
              /></IconButton>
              <IconButton
                title="Move tier down"
                :disabled="tIndex === grant.tiers.length - 1"
                @click="gs(gIndex).moveTier(tIndex, 1)"
                ><ArrowDown
              /></IconButton>
              <IconButton
                title="Duplicate tier"
                @click="gs(gIndex).duplicateTier(tIndex)"
                ><Copy
              /></IconButton>
              <IconButton
                title="Insert tier"
                @click="gs(gIndex).insertTier(tIndex)"
                ><CirclePlus
              /></IconButton>
              <IconButton
                title="Remove tier"
                @click="gs(gIndex).removeTier(tIndex)"
                ><Trash
              /></IconButton>
              <ComboBox
                class="combo--set w-44"
                :model-value="tier.set"
                :options="setComboOptions"
                placeholder="— set —"
                @update:model-value="(v) => (tier.set = v)"
              />
              <input
                v-model.number="tier.atLeast"
                type="number"
                min="1"
                class="w-16 rounded-md border border-line bg-surface px-1.5 py-0.5 text-right focus:outline-2 focus:-outline-offset-1 focus:outline-accent"
              />
              <span class="text-sm text-muted">piece(s) or more</span>
            </div>
            <div
              v-for="(stat, sIndex) in tier.stats"
              :key="sIndex"
              class="stat-row flex flex-wrap items-center gap-1.5 mb-1"
            >
              <IconButton
                title="Add stat"
                @click="gs(gIndex).addTierStat(tIndex)"
                ><Plus
              /></IconButton>
              <IconButton
                title="Remove stat"
                @click="gs(gIndex).removeTierStat(sIndex, tIndex)"
                ><Trash
              /></IconButton>
              <ComboBox
                class="combo--stat w-52"
                :model-value="stat.key"
                :options="statComboOptions"
                placeholder="— pick a stat —"
                @update:model-value="(v) => (stat.key = v)"
              />
              <PercentInput
                v-if="isPercent(stat.key)"
                v-model="stat.value"
                class="w-28"
                @keydown="focusNextStat"
              />
              <input
                v-else
                v-model.number="stat.value"
                class="w-28 rounded-md border border-line bg-surface px-1.5 py-0.5 text-right focus:outline-2 focus:-outline-offset-1 focus:outline-accent"
                type="number"
                step="any"
                @keydown="focusNextStat"
              />
            </div>
            <div v-if="!tier.stats.length" class="mt-1 flex flex-wrap gap-1">
              <IconButton
                title="Add stat"
                @click="gs(gIndex).addTierStat(tIndex)"
                ><Plus
              /></IconButton>
            </div>
          </div>
          <IconButton
            v-if="!grant.tiers.length"
            title="Add tier"
            @click="gs(gIndex).addTier()"
            ><CirclePlus
          /></IconButton>
        </template>

        <!-- variant payload -->
        <template v-else>
          <p class="text-sm text-muted">
            The first variant whose own condition matches wins -- order them
            most-specific first. Each variant's payload replaces the others, it
            does not add to them.
          </p>
          <div
            v-for="(variant, vIndex) in grant.variants"
            :key="variant.uid"
            class="my-1.5 rounded-md border border-line border-l-4 border-l-accent bg-surface px-2.5 py-1.5"
          >
            <div class="mb-1 flex flex-wrap items-center gap-1.5">
              <span class="text-sm text-muted">Variant {{ vIndex + 1 }}</span>
              <span class="flex-1"></span>
              <IconButton
                title="Move variant up"
                :disabled="vIndex === 0"
                @click="gs(gIndex).moveVariant(vIndex, -1)"
              >
                <ArrowUp />
              </IconButton>
              <IconButton
                title="Move variant down"
                :disabled="vIndex === grant.variants.length - 1"
                @click="gs(gIndex).moveVariant(vIndex, 1)"
              >
                <ArrowDown />
              </IconButton>
              <IconButton
                title="Duplicate variant"
                @click="gs(gIndex).duplicateVariant(vIndex)"
              >
                <Copy />
              </IconButton>
              <IconButton
                title="Insert variant"
                @click="gs(gIndex).insertVariant(vIndex)"
              >
                <CirclePlus />
              </IconButton>
              <IconButton
                title="Remove variant"
                @click="gs(gIndex).removeVariant(vIndex)"
              >
                <Trash />
              </IconButton>
            </div>
            <FormSection sub>When</FormSection>
            <ConditionRows
              :rows="variant.conditions"
              :depth="0"
              :set-ids="props.store.setIds"
              @update="
                (updated) =>
                  props.store.setVariantConditions(gIndex, vIndex, updated)
              "
            />
            <FormSection sub>Grants</FormSection>
            <div
              v-for="(stat, sIndex) in variant.stats"
              :key="sIndex"
              class="stat-row flex flex-wrap items-center gap-1.5 mb-1"
            >
              <IconButton
                title="Add stat"
                @click="gs(gIndex).addVariantStat(vIndex)"
                ><Plus
              /></IconButton>
              <IconButton
                title="Remove stat"
                @click="gs(gIndex).removeVariantStat(sIndex, vIndex)"
                ><Trash
              /></IconButton>
              <ComboBox
                class="combo--stat w-52"
                :model-value="stat.key"
                :options="statComboOptions"
                placeholder="— pick a stat —"
                @update:model-value="(v) => (stat.key = v)"
              />
              <PercentInput
                v-if="isPercent(stat.key)"
                v-model="stat.value"
                class="w-28"
                @keydown="focusNextStat"
              />
              <input
                v-else
                v-model.number="stat.value"
                class="w-28 rounded-md border border-line bg-surface px-1.5 py-0.5 text-right focus:outline-2 focus:-outline-offset-1 focus:outline-accent"
                type="number"
                step="any"
                @keydown="focusNextStat"
              />
            </div>
            <div
              v-if="!variant.stats.length"
              class="stat-row flex flex-wrap items-center gap-1.5 mb-1"
            >
              <IconButton
                title="Add stat"
                @click="gs(gIndex).addVariantStat(vIndex)"
                ><Plus
              /></IconButton>
            </div>
          </div>
          <BaseButton
            variant="link"
            data-testid="add-variant"
            @click="gs(gIndex).addVariant()"
            ><CirclePlus />add variant</BaseButton
          >
        </template>
      </template>
    </div>
  </div>
</template>
