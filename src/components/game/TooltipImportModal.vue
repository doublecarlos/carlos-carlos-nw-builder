<script setup lang="ts">
// Read an item off a tooltip screenshot: paste or drop the image, OCR reads it, the text stays
// editable, and the parser turns it into a list of fields -- the item's name, its game id and
// its base stats.
//
// Two ways out, because a screenshot is as often a correction to an item that already exists
// as it is a new one. "Create item" seeds an ordinary new draft in ItemForm; the arrow beside
// each field sends just that value into whatever item the editor has open beside this window.
// Neither writes to the catalog -- a created draft still needs an explicit Save, and an
// applied field is an ordinary edit of the item it lands on.
//
// The recognised text is shown and editable on purpose. OCR here omits fields rather than
// getting them wrong, so the useful correction is usually "it missed a line", which is far
// easier to spot and fix in the text than in a half-filled form.
//
// Modal rather than in-flow: pasting is the whole point, and a paste only reaches a handler
// bound to an element once focus is already inside it. Owning the screen is what lets the
// screenshot land wherever the cursor happens to be when the window opens.
import { computed, ref } from "vue";
import { useEventListener } from "@vueuse/core";
import { ArrowRightToLine, Check, CirclePlus, LoaderCircle } from "@lucide/vue";
import BaseButton from "../ui/BaseButton.vue";
import BaseModal from "../ui/BaseModal.vue";
import IconButton from "../ui/IconButton.vue";
import { parseTooltip } from "../../lib/tooltip-parser";
import { label, signedStat } from "../../lib/format";
import type { Item } from "../../types";

const props = withDefaults(
  defineProps<{
    /** How to refer to the item the editor has open beside this window -- already formatted
     *  for prose ('"Omen of Doom"', "the new item"), since the caller is the one that knows
     *  whether it is a saved item or a fresh draft. `null` when no item form is showing, which
     *  is what disables the apply buttons. */
    applyTarget?: string | null;
  }>(),
  { applyTarget: null },
);

const emit = defineEmits<{
  create: [draft: Partial<Item>];
  /** One or more parsed values, for the caller to merge into the item it has open.
   *  `label` names them for the confirmation the caller shows. */
  apply: [payload: { patch: Partial<Item>; label: string }];
  close: [];
}>();

/** The first image on a paste or drop, if there is one. Kept out of `ocr.ts` so that module
 *  -- and the OCR engine it pulls in -- stays behind the dynamic import in `read`. */
function imageFrom(
  items: DataTransferItemList | null | undefined,
): File | null {
  for (const item of items ?? []) {
    if (item.kind === "file" && item.type.startsWith("image/")) {
      const file = item.getAsFile();
      if (file) return file;
    }
  }
  return null;
}

const text = ref("");
const busy = ref(false);
const error = ref("");
const result = computed(() => parseTooltip(text.value));

/** One recognised value, in the shape both exits need: something to show, and the item-shaped
 *  patch that carries it. */
interface Field {
  id: string;
  label: string;
  display: string;
  patch: Partial<Item>;
}

const fields = computed<Field[]>(() => {
  const { draft, gameId, stats } = result.value;
  const list: Field[] = [];
  if (draft.name)
    list.push({
      id: "name",
      label: "Name",
      display: draft.name,
      patch: { name: draft.name },
    });
  if (gameId)
    list.push({
      id: "game-id",
      label: "Game ID",
      display: gameId,
      patch: { gameIds: [gameId] },
    });
  for (const stat of stats)
    list.push({
      id: `stat-${stat.key}`,
      label: label(stat.key),
      display: signedStat(stat.key, stat.value),
      patch: { [stat.key]: stat.value },
    });
  return list;
});

/** Creating an item needs a recognised *value*, not just a name: `findName` returns the first
 *  line that is not chrome, so any prose at all produces one, and a name alone is no evidence
 *  the text was ever a tooltip. Applying single fields has no such problem -- the name is
 *  picked deliberately, one button at a time. */
const canCreate = computed(
  () => result.value.stats.length > 0 || Boolean(result.value.gameId),
);

/** Applied fields, stamped with the value that was sent: a tick then survives edits elsewhere
 *  in the text box, but clears the moment its own field's value changes. */
const applied = ref(new Set<string>());
const stamp = (field: Field) => `${field.id}=${field.display}`;
const isApplied = (field: Field) => applied.value.has(stamp(field));

function applyField(field: Field) {
  emit("apply", { patch: field.patch, label: field.label });
  applied.value = new Set(applied.value).add(stamp(field));
}

function applyAll() {
  const list = fields.value;
  if (!list.length) return;
  emit("apply", {
    patch: Object.assign(
      {},
      ...list.map((field) => field.patch),
    ) as Partial<Item>,
    label: `${list.length} field${list.length > 1 ? "s" : ""}`,
  });
  applied.value = new Set([...applied.value, ...list.map(stamp)]);
}

/** Trailing half of every apply label, so the buttons name their destination rather than
 *  leaving "apply" to mean "somewhere". */
const applyHint = computed(() =>
  props.applyTarget
    ? `to ${props.applyTarget}`
    : "— open an item in the layer editor to apply values to it",
);

async function read(image: Blob) {
  busy.value = true;
  error.value = "";
  try {
    // Loaded on demand: the engine and its model are several megabytes that nobody who
    // never opens this window should have to fetch.
    const { readTooltip } = await import("../../lib/ocr");
    text.value = await readTooltip(image);
    if (!text.value.trim()) error.value = "No text was found in that image.";
  } catch (e) {
    error.value = `Could not read that image: ${e instanceof Error ? e.message : String(e)}`;
  } finally {
    busy.value = false;
  }
}

function onPaste(event: ClipboardEvent) {
  const image = imageFrom(event.clipboardData?.items);
  if (!image) return; // plain text paste falls through to the textarea
  event.preventDefault();
  void read(image);
}

function onDrop(event: DragEvent) {
  const image = imageFrom(event.dataTransfer?.items);
  if (!image) return;
  event.preventDefault();
  void read(image);
}

function onPick(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0];
  if (file) void read(file);
}

// Document-level, not on the panel: Ctrl+V is the primary interaction, and it has to work the
// instant the window opens rather than after a click lands focus inside it. A plain text paste
// still falls through to whatever is focused -- `onPaste` only acts on an image.
useEventListener(document, "paste", onPaste);
</script>

<template>
  <BaseModal
    title="Read an item from a tooltip"
    panel-class="max-h-[85vh] w-[760px] max-w-[92vw]"
    data-testid="tooltip-import"
    @close="emit('close')"
    @dragover.prevent
    @drop="onDrop"
  >
    <div class="flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto p-4">
      <div class="flex flex-wrap items-baseline gap-2">
        <span class="text-muted"
          >Paste or drop a screenshot. Base stats are filled in; bonuses stay
          yours to author.</span
        >
        <span class="flex-1"></span>
        <BaseButton as="label" :disabled="busy"
          >Choose image…
          <input
            type="file"
            accept="image/*"
            hidden
            data-testid="tooltip-import-file"
            @change="onPick"
        /></BaseButton>
      </div>

      <p v-if="busy" class="flex items-center gap-1.5 text-muted">
        <LoaderCircle class="animate-spin" />Reading the screenshot…
      </p>
      <p v-if="error" class="text-error" data-testid="tooltip-import-error">
        {{ error }}
      </p>

      <textarea
        v-model="text"
        rows="8"
        data-testid="tooltip-import-text"
        class="w-full flex-none resize-y rounded-md border border-line bg-surface px-2 py-1.5 font-mono"
        placeholder="Paste a screenshot here — the recognised text appears in this box, where you can correct it before creating the item."
      ></textarea>

      <div v-if="text.trim()" class="flex flex-col gap-2 lg:flex-row">
        <section class="min-w-0 flex-1">
          <h4 class="mb-1 text-muted">Recognised ({{ fields.length }})</h4>
          <p v-if="!fields.length" class="text-muted">
            No stat lines recognised yet.
          </p>
          <template v-else>
            <ul data-testid="tooltip-import-stats" class="flex flex-col">
              <li
                v-for="field in fields"
                :key="field.id"
                :data-testid="`tooltip-import-field-${field.id}`"
                class="flex items-center justify-between gap-3 border-b border-line/45 py-0.5"
              >
                <span class="truncate">{{ field.label }}</span>
                <span class="flex min-w-0 items-center gap-1">
                  <span class="min-w-0 truncate font-mono">{{
                    field.display
                  }}</span>
                  <Check
                    v-if="isApplied(field)"
                    class="size-[14px] flex-none text-accent"
                    :aria-label="`${field.label} applied`"
                  />
                  <IconButton
                    v-else
                    class="flex-none"
                    :disabled="!applyTarget"
                    :title="`Apply ${field.label} ${applyHint}`"
                    :data-testid="`tooltip-import-apply-${field.id}`"
                    @click="applyField(field)"
                    ><ArrowRightToLine
                  /></IconButton>
                </span>
              </li>
            </ul>
            <p class="mt-1 text-muted">
              Create a new item below, or send a single value {{ applyHint }}.
            </p>
          </template>
        </section>

        <section v-if="result.bonusLines.length" class="min-w-0 flex-1">
          <h4 class="mb-1 text-muted">
            Not applied — granted by an enchantment or kit ({{
              result.bonusLines.length
            }})
          </h4>
          <ul data-testid="tooltip-import-bonus-lines" class="flex flex-col">
            <li
              v-for="(line, i) in result.bonusLines"
              :key="i"
              class="truncate border-b border-line/45 py-0.5 text-muted"
            >
              {{ line }}
            </li>
          </ul>
        </section>

        <section v-if="result.unmatched.length" class="min-w-0 flex-1">
          <h4 class="mb-1 text-muted">
            Not recognised ({{ result.unmatched.length }})
          </h4>
          <ul data-testid="tooltip-import-unmatched" class="flex flex-col">
            <li
              v-for="(line, i) in result.unmatched"
              :key="i"
              class="truncate border-b border-line/45 py-0.5 text-muted"
            >
              {{ line }}
            </li>
          </ul>
        </section>
      </div>
    </div>

    <div class="flex flex-none gap-1.5 border-t border-line px-4 py-3">
      <BaseButton
        variant="primary"
        :disabled="!canCreate || busy"
        data-testid="tooltip-import-create"
        @click="emit('create', result.draft)"
        ><CirclePlus />Create item</BaseButton
      >
      <BaseButton
        :disabled="!fields.length || !applyTarget || busy"
        :title="`Apply every recognised value ${applyHint}`"
        data-testid="tooltip-import-apply-all"
        @click="applyAll"
        ><ArrowRightToLine />Apply all</BaseButton
      >
      <BaseButton @click="emit('close')">Cancel</BaseButton>
    </div>
  </BaseModal>
</template>
