<script setup lang="ts">
// Editor for a bonus's list of grants. See stores/bonus-draft.ts for the structural
// notes (anonymous grants, flat/tiered/variants payloads, the JSON escape hatch).
//
// This component no longer emits a replaced `rows` array when a grant is edited. Instead,
// all mutations go through the `store` - a `BonusDraftStore` created in BonusForm that
// writes directly onto `draft.value.grants`. The store's `onChange()` is called after every
// mutation, which schedules an undo snapshot in BonusForm.

import { inject, ref } from "vue";
import BonusComboBox from "./BonusComboBox.vue";
import ConditionRows, {
  type ConditionTreeLocation,
  type ConditionBranchTreeLocation,
} from "./ConditionRows.vue";
import IconButton from "../ui/IconButton.vue";
import StatRowList from "./StatRowList.vue";
import DynamicStatRowList from "./DynamicStatRowList.vue";
import {
  ArrowDown,
  ArrowUp,
  CirclePlus,
  Copy,
  FileJson,
  Plus,
  Trash,
} from "@lucide/vue";
import BaseButton from "../ui/BaseButton.vue";
import BaseCheckbox from "../ui/BaseCheckbox.vue";
import BaseInput from "../ui/BaseInput.vue";
import BaseTextarea from "../ui/BaseTextarea.vue";
import SegmentedControl from "../ui/SegmentedControl.vue";
import DragHandle from "../ui/DragHandle.vue";
import OcrTextField from "../ui/OcrTextField.vue";
import FormSection from "../ui/FormSection.vue";
import {
  BonusDraftStore,
  moveConditionAcrossStores,
  moveBranchAcrossStores,
  type ConditionLocation,
  type ConditionBranchLocation,
} from "../../stores/bonus-draft";
import type { GrantDraft } from "../../lib/bonus-draft";
import type { BonusOption } from "../../types";
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
    tags?: string[];
    /** Every known bonus, for the tier and occurrence-condition pickers. */
    bonusOptions?: BonusOption[];
    /** This bonus's key in ItemBonuses' cross-bonus condition-drag registry, forwarded from
     *  BonusForm -- see bonusDraftRegistry.ts. Empty outside ItemBonuses. */
    registryId?: string;
  }>(),
  { tags: () => [], bonusOptions: () => [], registryId: "" },
);

// Guard against a grant being removed while an event handler is still firing.
function gs(index: number) {
  const s = props.store.grantStore(index);
  if (!s) throw new Error(`Grant index out of range: ${index}`);
  return s;
}

// Name/description is a per-grant collapsed-behind-a-"+" group, same idea as ItemForm.vue's
// dynamic-modification/inline-repetition toggles -- but there's one of *those* per item and
// N of *these* (one per grant), so a single boolean ref won't do. `expandedNameDescUids` only
// has to remember which grants the user explicitly opened *this session*: a grant already
// carrying a name/description shows open on its own via `hasNameDescription`, and removing
// clears the fields (so `hasNameDescription` goes false) *and* drops the uid (so the explicit
// override goes away too) -- both have to give way for the group to collapse back down.
const expandedNameDescUids = ref(new Set<string>());
function hasNameDescription(grant: GrantDraft): boolean {
  return Boolean(grant.name || grant.shortDescription || grant.longDescription);
}
function nameDescriptionActive(grant: GrantDraft): boolean {
  return hasNameDescription(grant) || expandedNameDescUids.value.has(grant.uid);
}
function addNameDescription(grant: GrantDraft) {
  expandedNameDescUids.value.add(grant.uid);
}
function removeNameDescription(gIndex: number) {
  const grant = props.store.grants[gIndex];
  if (!grant) return;
  grant.name = "";
  grant.shortDescription = "";
  grant.longDescription = "";
  expandedNameDescUids.value.delete(grant.uid);
}

// --- drag-and-drop: grants, and each grant's tiers/variants ----------------------------
// Grants aren't shared across bonuses (unlike conditions -- see ConditionRows.vue), so
// reordering is always local to this one BonusDraftStore instance. `instanceId` keeps this
// component's grant list from accepting a drop dragged out of a *different* BonusRows
// instance (e.g. another bonus in the same item's ItemBonuses) if one happens to be open at
// the same time. Tiers/variants are scoped to their own grant the same way, via the grant's
// own uid.
const instanceId = `bonus-rows:${Math.random().toString(36).slice(2)}`;
const grantsContainerId = `grants:${instanceId}`;

const grantsDropList = useDropList({
  containerId: grantsContainerId,
  size: () => props.store.grants.length,
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

// One `useDropList` per grant, cached by uid (NavBuilds.vue's `folderDrop` is the same idea).
// `gIndex` is resolved fresh via `grantIndexByUid` rather than captured: grants reorder via
// `moveGrantTo`, so a captured index would go stale across that move.
function grantIndexByUid(grantUid: string): number {
  return props.store.grants.findIndex((g) => g.uid === grantUid);
}

const tierDropLists = new Map<string, ReturnType<typeof useDropList>>();
function tierDropList(grantUid: string) {
  let list = tierDropLists.get(grantUid);
  if (!list) {
    const containerId = `tiers:${grantUid}`;
    list = useDropList({
      containerId,
      size: () =>
        props.store.grants[grantIndexByUid(grantUid)]?.tiers.length ?? 0,
      accepts: (source) =>
        source.kind === "tier" && source.containerId === containerId,
      onDrop: (source, index) => {
        const gIndex = grantIndexByUid(grantUid);
        if (gIndex === -1) return;
        gs(gIndex).moveTierTo(source.index, index);
      },
    });
    tierDropLists.set(grantUid, list);
  }
  return list;
}
function tierDragHandleProps(grantUid: string, index: number) {
  return useDragHandle((): DragSource => ({
    kind: "tier",
    containerId: `tiers:${grantUid}`,
    key: String(index),
    index,
  }));
}

const variantDropLists = new Map<string, ReturnType<typeof useDropList>>();
function variantDropList(grantUid: string) {
  let list = variantDropLists.get(grantUid);
  if (!list) {
    const containerId = `variants:${grantUid}`;
    list = useDropList({
      containerId,
      size: () =>
        props.store.grants[grantIndexByUid(grantUid)]?.variants.length ?? 0,
      accepts: (source) =>
        source.kind === "variant" && source.containerId === containerId,
      onDrop: (source, index) => {
        const gIndex = grantIndexByUid(grantUid);
        if (gIndex === -1) return;
        gs(gIndex).moveVariantTo(source.index, index);
      },
    });
    variantDropLists.set(grantUid, list);
  }
  return list;
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
// `registryId`, e.g. a ItemBonuses slot key) ahead of which grant/variant tree within that
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
 *  different bonus's store entirely (ItemBonuses.vue only; standalone forms have no registry,
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

/** Same as `onConditionTransfer`, but for a whole branch dropped into a different group. */
function onBranchTransfer(payload: {
  source: ConditionBranchTreeLocation;
  target: ConditionBranchTreeLocation;
}) {
  const sourceInfo = parseTreeId(payload.source.treeId);
  const targetInfo = parseTreeId(payload.target.treeId);
  const targetLocation: ConditionBranchLocation = {
    ...targetInfo.location,
    groupPath: payload.target.groupPath,
    branchIndex: payload.target.branchIndex,
  };

  if (sourceInfo.registryId === props.registryId) {
    props.store.moveBranch(
      {
        ...sourceInfo.location,
        groupPath: payload.source.groupPath,
        branchIndex: payload.source.branchIndex,
      },
      targetLocation,
    );
    return;
  }

  const sourceStore = bonusDraftRegistry?.get(sourceInfo.registryId);
  if (!sourceStore) return;
  moveBranchAcrossStores(
    {
      store: sourceStore,
      location: {
        ...sourceInfo.location,
        groupPath: payload.source.groupPath,
        branchIndex: payload.source.branchIndex,
      },
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
    // entered JSON mode - no error to emit
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
        <DragHandle
          data-testid="grant-drag-handle"
          v-bind="grantDragHandleProps(gIndex)"
        />
        <span class="text-muted">Grant {{ gIndex + 1 }}</span>
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

      <BaseTextarea
        v-if="grant.mode === 'json'"
        v-model="grant.json"
        class="mt-1 w-full font-mono"
        rows="8"
      />

      <template v-else>
        <FormSection sub>Active when</FormSection>
        <ConditionRows
          :rows="grant.conditions"
          :depth="0"
          :bonus-options="bonusOptions"
          :tree-id="grantTreeId(gIndex)"
          :path="[]"
          @update="(updated) => props.store.setConditions(gIndex, updated)"
          @transfer="onConditionTransfer"
          @transfer-branch="onBranchTransfer"
        />

        <FormSection sub>
          Payload
          <SegmentedControl
            :model-value="grant.payload"
            :options="[
              { value: 'flat', label: 'the same always' },
              { value: 'tiers', label: 'tiered by bonus occurrences' },
              { value: 'variants', label: 'varies by condition' },
              { value: 'problem', label: 'reports a problem' },
            ]"
            @update:model-value="gs(gIndex).setPayload($event)"
          />
        </FormSection>

        <!-- flat payload -->
        <template v-if="grant.payload === 'flat'">
          <StatRowList
            :rows="grant.stats"
            @add="gs(gIndex).addStat()"
            @remove="(i: number) => gs(gIndex).removeStat(i)"
          />

          <FormSection sub
            >Dynamic stats (player types the value; default applies until they
            do)</FormSection
          >
          <DynamicStatRowList
            :rows="grant.dynamicStats"
            @add="gs(gIndex).addDynamicStat()"
            @remove="(i: number) => gs(gIndex).removeDynamicStat(i)"
          />
        </template>

        <!-- tiered payload -->
        <template v-else-if="grant.payload === 'tiers'">
          <p class="text-muted">
            The highest matching tier wins and <strong>replaces</strong> the
            lower ones - each tier's stats are the total at that occurrence
            count, not an extra on top.
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
              tierDropList(grant.uid).indicatorAt(tIndex) === 'before' &&
                '!border-t-accent',
              tierDropList(grant.uid).indicatorAt(tIndex) === 'after' &&
                '!border-b-accent',
            ]"
            v-bind="tierDropList(grant.uid).rowProps(tIndex)"
          >
            <div class="mb-1 flex flex-wrap items-center gap-1.5">
              <DragHandle
                data-testid="tier-drag-handle"
                v-bind="tierDragHandleProps(grant.uid, tIndex)"
              />
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
              <BonusComboBox
                class="combo--bonus w-44"
                :model-value="tier.bonus"
                :options="bonusOptions"
                self
                @update:model-value="(v) => (tier.bonus = v)"
              />
              <BaseInput
                v-model.number="tier.atLeast"
                type="number"
                min="1"
                class="w-16"
              />
              <span class="text-muted"
                >{{ tier.atLeast === 1 ? "occurrence" : "occurrences" }} or
                more</span
              >
            </div>
            <StatRowList
              :rows="tier.stats"
              @add="gs(gIndex).addTierStat(tIndex)"
              @remove="(i: number) => gs(gIndex).removeTierStat(i, tIndex)"
            />
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
          <p class="text-muted">
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
              variantDropList(grant.uid).indicatorAt(vIndex) === 'before' &&
                '!border-t-accent',
              variantDropList(grant.uid).indicatorAt(vIndex) === 'after' &&
                '!border-b-accent',
            ]"
            v-bind="variantDropList(grant.uid).rowProps(vIndex)"
          >
            <div class="mb-1 flex flex-wrap items-center gap-2">
              <DragHandle
                data-testid="variant-drag-handle"
                v-bind="variantDragHandleProps(grant.uid, variant.uid, vIndex)"
              />
              <span class="text-muted">Variant {{ vIndex + 1 }}</span>
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
              :bonus-options="bonusOptions"
              :tree-id="variantTreeId(gIndex, vIndex)"
              :path="[]"
              @update="
                (updated) =>
                  props.store.setVariantConditions(gIndex, vIndex, updated)
              "
              @transfer="onConditionTransfer"
              @transfer-branch="onBranchTransfer"
            />
            <FormSection sub>Grants</FormSection>
            <StatRowList
              :rows="variant.stats"
              @add="gs(gIndex).addVariantStat(vIndex)"
              @remove="(i: number) => gs(gIndex).removeVariantStat(i, vIndex)"
            />

            <FormSection sub
              >Dynamic stats (player types the value; default applies until they
              do)</FormSection
            >
            <DynamicStatRowList
              :rows="variant.dynamicStats"
              @add="gs(gIndex).addVariantDynamicStat(vIndex)"
              @remove="
                (i: number) => gs(gIndex).removeVariantDynamicStat(i, vIndex)
              "
            />
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
          <p class="text-muted">
            Shown inline on the slot and in the sidebar's problem summary
            whenever "Active when" matches -- it grants no stats.
          </p>
          <div class="mb-1.5 flex flex-wrap items-center gap-1.5">
            <span class="text-muted">Severity</span>
            <SegmentedControl
              v-model="grant.problemSeverity"
              :options="[
                {
                  value: 'error',
                  label: 'error',
                  tone: 'danger',
                  testid: 'problem-severity-error',
                },
                {
                  value: 'warning',
                  label: 'warning',
                  tone: 'warn',
                  testid: 'problem-severity-warning',
                },
              ]"
            />
          </div>
          <BaseInput
            v-model="grant.problemLabel"
            data-testid="problem-label"
            type="text"
            class="mb-1.5 w-full"
            placeholder="Label shown in the sidebar summary (defaults to the slot's name)…"
          />
          <BaseTextarea
            v-model="grant.problemMessage"
            data-testid="problem-message"
            class="mb-1.5 w-full"
            rows="2"
            placeholder="Message shown to the user when this condition matches…"
          />
          <BaseCheckbox
            v-model="grant.problemHideFromPicker"
            data-testid="problem-hide-from-picker"
            inline
          >
            Also filter matching items out of item picker dropdowns, not just
            flag them once picked
          </BaseCheckbox>
        </template>

        <FormSection sub>Name and description (optional)</FormSection>
        <div class="mb-1.5 flex flex-wrap items-start gap-1.5">
          <IconButton
            v-if="!nameDescriptionActive(grant)"
            title="Add name and description"
            data-testid="add-grant-name-description"
            @click="addNameDescription(grant)"
            ><Plus
          /></IconButton>
          <IconButton
            v-else
            title="Remove name and description"
            data-testid="remove-grant-name-description"
            @click="removeNameDescription(gIndex)"
            ><Trash
          /></IconButton>
          <div
            v-if="nameDescriptionActive(grant)"
            class="flex min-w-0 flex-1 flex-col gap-1.5"
            data-testid="grant-name-description-fields"
          >
            <BaseInput
              v-model="grant.name"
              data-testid="grant-name"
              type="text"
              class="w-full"
              placeholder="Name, distinguishes this grant from the bonus's other grants on the hover card…"
            />
            <OcrTextField
              v-model="grant.shortDescription"
              single-line
              :rows="2"
              data-testid="grant-short-description"
              placeholder="Short description, shown next to the item's stat summary when active…"
            />
            <OcrTextField
              v-model="grant.longDescription"
              :rows="2"
              data-testid="grant-long-description"
              placeholder="Long description, shown on the item's hover card when active…"
            />
          </div>
        </div>
      </template>
    </div>
  </div>
</template>
