<script setup lang="ts">
// Editor for a bonus set's list of grants. See stores/bonus-draft.ts for the structural
// notes (anonymous grants, flat/tiered/variants payloads, the JSON escape hatch).
//
// This component no longer emits a replaced `rows` array when a grant is edited. Instead,
// all mutations go through the `store` — a `BonusDraftStore` created in BonusSetForm that
// writes directly onto `draft.value.grants`. The store's `onChange()` is called after every
// mutation, which schedules an undo snapshot in BonusSetForm.

import { computed, inject } from "vue";
import PercentInput from "../ui/PercentInput.vue";
import ComboBox from "../ui/ComboBox.vue";
import ConditionRows, { type ConditionTreeLocation } from "./ConditionRows.vue";
import IconButton from "../ui/IconButton.vue";
import {
  ArrowDown,
  ArrowUp,
  CirclePlus,
  Copy,
  FileJson,
  GripVertical,
  Plus,
  Trash,
} from "@lucide/vue";
import BaseButton from "../ui/BaseButton.vue";
import BaseCheckbox from "../ui/BaseCheckbox.vue";
import FormSection from "../ui/FormSection.vue";
import { isPercentKind, kindOf, statPickerOptions } from "../../lib/format";
import { focusNextCombo } from "../../lib/stat-row-nav";
import {
  BonusDraftStore,
  moveConditionAcrossStores,
  type ConditionLocation,
} from "../../stores/bonus-draft";
import { bonusDraftRegistryKey } from "../../composables/bonusDraftRegistry";
import {
  useDragHandle,
  useDropList,
  type DragSource,
} from "../../composables/useDragAndDrop";

const emit = defineEmits<{ error: [message: string] }>();

const props = withDefaults(
  defineProps<{
    store: BonusDraftStore;
    setIds?: string[];
    tags?: string[];
    /** This bonus's key in BonusGroups' cross-bonus condition-drag registry, forwarded from
     *  BonusSetForm -- see bonusDraftRegistry.ts. Empty outside BonusGroups. */
    registryId?: string;
  }>(),
  { setIds: () => [], tags: () => [], registryId: "" },
);

const statComboOptions = statPickerOptions;
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

// --- drag-and-drop: grants, and each grant's tiers/variants ----------------------------
// Grants aren't shared across bonuses (unlike conditions -- see ConditionRows.vue), so
// reordering is always local to this one BonusDraftStore instance. `instanceId` keeps this
// component's grant list from accepting a drop dragged out of a *different* BonusRows
// instance (e.g. another bonus in the same item's BonusGroups) if one happens to be open at
// the same time. Tiers/variants are scoped to their own grant the same way, via the grant's
// own uid.
const instanceId = `bonus-rows:${Math.random().toString(36).slice(2)}`;
const grantsContainerId = `grants:${instanceId}`;

const grantsDropList = useDropList({
  containerId: grantsContainerId,
  accepts: (source) =>
    source.kind === "grant" && source.containerId === grantsContainerId,
  onDrop: (source, index) => props.store.moveGrantTo(source.index, index),
});
function grantDragHandleProps(index: number) {
  return useDragHandle((): DragSource => ({
    kind: "grant",
    containerId: grantsContainerId,
    key: props.store.grants[index]?.uid ?? String(index),
    index,
  }));
}

function tierDropList(grantUid: string, gIndex: number) {
  const containerId = `tiers:${grantUid}`;
  return useDropList({
    containerId,
    accepts: (source) =>
      source.kind === "tier" && source.containerId === containerId,
    onDrop: (source, index) => gs(gIndex).moveTierTo(source.index, index),
  });
}
function tierDragHandleProps(grantUid: string, index: number) {
  return useDragHandle((): DragSource => ({
    kind: "tier",
    containerId: `tiers:${grantUid}`,
    key: String(index),
    index,
  }));
}

function variantDropList(grantUid: string, gIndex: number) {
  const containerId = `variants:${grantUid}`;
  return useDropList({
    containerId,
    accepts: (source) =>
      source.kind === "variant" && source.containerId === containerId,
    onDrop: (source, index) => gs(gIndex).moveVariantTo(source.index, index),
  });
}
function variantDragHandleProps(
  grantUid: string,
  variantUid: string,
  index: number,
) {
  return useDragHandle((): DragSource => ({
    kind: "variant",
    containerId: `variants:${grantUid}`,
    key: variantUid,
    index,
  }));
}

// --- drag-and-drop: condition trees, including cross-grant/cross-variant/cross-bonus -------
// A condition's ConditionRows tree-id encodes which bonus it belongs to (this instance's own
// `registryId`, e.g. a BonusGroups slot key) ahead of which grant/variant tree within that
// bonus -- a space separates the two, since registryId values ("id:foo", "pending:3") and the
// grant/variant tag both already use colons. ConditionRows.vue itself never looks inside a
// tree-id; only the two parse/build functions below do.
const TREE_ID_SEP = " ";
function grantTreeId(gIndex: number) {
  return `${props.registryId}${TREE_ID_SEP}grant:${gIndex}`;
}
function variantTreeId(gIndex: number, vIndex: number) {
  return `${props.registryId}${TREE_ID_SEP}variant:${gIndex}:${vIndex}`;
}
function parseTreeId(treeId: string): {
  registryId: string;
  location: Omit<ConditionLocation, "path">;
} {
  const [registryId, rest] = treeId.split(TREE_ID_SEP);
  const parts = rest?.split(":") ?? [];
  return parts[0] === "variant"
    ? {
        registryId,
        location: {
          grantIndex: Number(parts[1]),
          scope: "variant",
          variantIndex: Number(parts[2]),
        },
      }
    : {
        registryId,
        location: { grantIndex: Number(parts[1]), scope: "grant" },
      };
}

const bonusDraftRegistry = inject(bonusDraftRegistryKey, null);

/** `ConditionRows.vue`'s `@transfer` handler for both the grant-level and every variant-level
 *  tree below -- a condition was dropped somewhere other than the rows list it started in.
 *  Resolves both ends fresh from their tree-ids, then either mutates this one store (same
 *  bonus, however far apart in its grant/variant trees) or reaches into the registry for a
 *  different bonus's store entirely (BonusGroups.vue only; standalone forms have no registry,
 *  so a cross-bonus drop there is silently a no-op -- there's nothing else it could target). */
function onConditionTransfer(payload: {
  source: ConditionTreeLocation;
  target: ConditionTreeLocation;
}) {
  const sourceInfo = parseTreeId(payload.source.treeId);
  const targetInfo = parseTreeId(payload.target.treeId);
  const targetLocation: ConditionLocation = {
    ...targetInfo.location,
    path: payload.target.path,
  };

  if (sourceInfo.registryId === props.registryId) {
    props.store.moveCondition(
      { ...sourceInfo.location, path: payload.source.path },
      targetLocation,
    );
    return;
  }

  const sourceStore = bonusDraftRegistry?.get(sourceInfo.registryId);
  if (!sourceStore) return;
  moveConditionAcrossStores(
    {
      store: sourceStore,
      location: { ...sourceInfo.location, path: payload.source.path },
    },
    { store: props.store, location: targetLocation },
  );
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
      data-testid="bonus-grant-row"
      class="mb-2 rounded-md border-2 border-line bg-surface-2 p-2.5"
      :class="[
        grantsDropList.indicatorAt(gIndex) === 'before' && '!border-t-accent',
        grantsDropList.indicatorAt(gIndex) === 'after' && '!border-b-accent',
      ]"
      v-bind="grantsDropList.rowProps(gIndex)"
    >
      <div class="flex flex-wrap items-center gap-2">
        <span
          data-testid="grant-drag-handle"
          title="Drag to reorder"
          class="cursor-grab text-muted hover:text-accent [&_svg]:size-[14px]"
          v-bind="grantDragHandleProps(gIndex)"
        >
          <GripVertical />
        </span>
        <span class="text-sm text-muted">Grant {{ gIndex + 1 }}</span>
        <div class="flex flex-wrap items-center gap-1.5">
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
          <IconButton
            :title="grant.mode === 'json' ? 'Use the form' : 'Edit as JSON'"
            @click="toggleJson(gIndex)"
          >
            <FileJson />
          </IconButton>
        </div>
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
          :tree-id="grantTreeId(gIndex)"
          :path="[]"
          @update="(updated) => props.store.setConditions(gIndex, updated)"
          @transfer="onConditionTransfer"
        />

        <FormSection sub>Description (optional)</FormSection>
        <div class="mb-1.5 flex flex-col gap-1.5">
          <input
            v-model="grant.shortDescription"
            data-testid="grant-short-description"
            type="text"
            class="w-full rounded-md border border-line bg-surface px-1.5 py-0.5 focus:outline-2 focus:-outline-offset-1 focus:outline-accent"
            placeholder="Short description, shown next to the item's stat summary when active…"
          />
          <textarea
            v-model="grant.longDescription"
            data-testid="grant-long-description"
            class="w-full resize-y rounded-md border border-line bg-surface p-2"
            rows="2"
            placeholder="Long description, shown on the item's hover card when active…"
          ></textarea>
        </div>

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
            <button
              type="button"
              class="border border-line px-2 py-0.5 text-sm first:rounded-l-md last:rounded-r-md last:border-l-0"
              :class="
                grant.payload === 'problem'
                  ? 'border-accent bg-accent-soft text-text'
                  : 'bg-surface text-muted'
              "
              @click="gs(gIndex).setPayload('problem')"
            >
              reports a problem
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
            data-testid="bonus-tier-row"
            class="my-1.5 rounded-md border-2 border-l-4 border-line border-l-accent bg-surface px-2.5 py-1.5"
            :class="[
              tierDropList(grant.uid, gIndex).indicatorAt(tIndex) ===
                'before' && '!border-t-accent',
              tierDropList(grant.uid, gIndex).indicatorAt(tIndex) === 'after' &&
                '!border-b-accent',
            ]"
            v-bind="tierDropList(grant.uid, gIndex).rowProps(tIndex)"
          >
            <div class="mb-1 flex flex-wrap items-center gap-1.5">
              <span
                data-testid="tier-drag-handle"
                title="Drag to reorder"
                class="cursor-grab text-muted hover:text-accent [&_svg]:size-[14px]"
                v-bind="tierDragHandleProps(grant.uid, tIndex)"
              >
                <GripVertical />
              </span>
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
        <template v-else-if="grant.payload === 'variants'">
          <p class="text-sm text-muted">
            The first variant whose own condition matches wins -- order them
            most-specific first. Each variant's payload replaces the others, it
            does not add to them.
          </p>
          <div
            v-for="(variant, vIndex) in grant.variants"
            :key="variant.uid"
            data-testid="bonus-variant-row"
            class="my-1.5 rounded-md border-2 border-l-4 border-line border-l-accent bg-surface px-2.5 py-1.5"
            :class="[
              variantDropList(grant.uid, gIndex).indicatorAt(vIndex) ===
                'before' && '!border-t-accent',
              variantDropList(grant.uid, gIndex).indicatorAt(vIndex) ===
                'after' && '!border-b-accent',
            ]"
            v-bind="variantDropList(grant.uid, gIndex).rowProps(vIndex)"
          >
            <div class="mb-1 flex flex-wrap items-center gap-2">
              <span
                data-testid="variant-drag-handle"
                title="Drag to reorder"
                class="cursor-grab text-muted hover:text-accent [&_svg]:size-[14px]"
                v-bind="variantDragHandleProps(grant.uid, variant.uid, vIndex)"
              >
                <GripVertical />
              </span>
              <span class="text-sm text-muted">Variant {{ vIndex + 1 }}</span>
              <div class="flex flex-wrap items-center gap-1.5">
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
            </div>
            <FormSection sub>When</FormSection>
            <ConditionRows
              :rows="variant.conditions"
              :depth="0"
              :set-ids="props.store.setIds"
              :tree-id="variantTreeId(gIndex, vIndex)"
              :path="[]"
              @update="
                (updated) =>
                  props.store.setVariantConditions(gIndex, vIndex, updated)
              "
              @transfer="onConditionTransfer"
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

        <!-- problem payload: reports a build error/warning instead of granting stats -->
        <template v-else-if="grant.payload === 'problem'">
          <p class="text-sm text-muted">
            Shown inline on the slot and in the sidebar's problem summary
            whenever "Active when" matches -- it grants no stats.
          </p>
          <div class="mb-1.5 flex flex-wrap items-center gap-1.5">
            <span class="text-sm text-muted">Severity</span>
            <div class="inline-flex">
              <button
                type="button"
                data-testid="problem-severity-error"
                class="border border-line px-2 py-0.5 text-sm first:rounded-l-md last:rounded-r-md last:border-l-0"
                :class="
                  grant.problemSeverity === 'error'
                    ? 'border-danger bg-danger-soft text-danger'
                    : 'bg-surface text-muted'
                "
                @click="grant.problemSeverity = 'error'"
              >
                error
              </button>
              <button
                type="button"
                data-testid="problem-severity-warning"
                class="border border-line px-2 py-0.5 text-sm first:rounded-l-md last:rounded-r-md last:border-l-0"
                :class="
                  grant.problemSeverity === 'warning'
                    ? 'border-warn bg-warn/25 text-warn'
                    : 'bg-surface text-muted'
                "
                @click="grant.problemSeverity = 'warning'"
              >
                warning
              </button>
            </div>
          </div>
          <input
            v-model="grant.problemLabel"
            data-testid="problem-label"
            type="text"
            class="mb-1.5 w-full rounded-md border border-line bg-surface px-1.5 py-0.5 focus:outline-2 focus:-outline-offset-1 focus:outline-accent"
            placeholder="Label shown in the sidebar summary (defaults to the slot's name)…"
          />
          <textarea
            v-model="grant.problemMessage"
            data-testid="problem-message"
            class="mb-1.5 w-full resize-y rounded-md border border-line bg-surface p-2"
            rows="2"
            placeholder="Message shown to the user when this condition matches…"
          ></textarea>
          <BaseCheckbox
            v-model="grant.problemHideFromPicker"
            data-testid="problem-hide-from-picker"
            inline
          >
            Also filter matching items out of item picker dropdowns, not just
            flag them once picked
          </BaseCheckbox>
        </template>
      </template>
    </div>
  </div>
</template>
