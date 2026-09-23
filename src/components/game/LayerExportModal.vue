<script setup lang="ts">
// LayerEditor's export window: this layer's raw overlay JSON, plus, in maintainer mode, the
// composed data files across every enabled layer. The parent keeps the active tab.
//
// The maintainer tabs can also send their file to the local server (data/writeback.ts).
//
// Modal rather than in-flow: you come here to take a file somewhere and then leave, so
// nothing behind it matters meanwhile, and the tabs want the room.
import { computed, ref, watch, watchEffect } from "vue";
import { Copy, Download, Save } from "@lucide/vue";
import BaseButton from "../ui/BaseButton.vue";
import BaseModal from "../ui/BaseModal.vue";
import BaseTooltip from "../ui/BaseTooltip.vue";
import CodeBlock from "../ui/CodeBlock.vue";
import TabStrip from "../ui/TabStrip.vue";
import TabButton from "../ui/TabButton.vue";
import * as catalog from "../../data/catalog";
import * as layers from "../../stores/layers";
import * as maintainer from "../../stores/maintainer";
import type { CatalogOverlay } from "../../types";

const props = defineProps<{
  /** This layer's own raw overlay, for the "This layer" tab. */
  overlay: CatalogOverlay;
}>();

const emit = defineEmits<{
  notice: [message: string];
  close: [];
}>();

const activeTab = defineModel<string>({ default: "overlay" }); // overlay | a DATA_FILES tab

// The maintainer tabs are only useful with the source repo, so they are opt-in.
const maintainerTabsEnabled = maintainer.enabled;

type CatalogExportModule = typeof import("../../data/catalogExport");
type WritebackModule = typeof import("../../data/writeback");
type Composed = ReturnType<typeof catalog.compose>;

interface DataFileTab {
  tab: string;
  /** The file under `data/` the tab regenerates; doubles as the tab's label. */
  file: string;
  /** `composed` folds every enabled layer. */
  render: (exporter: CatalogExportModule, composed: Composed) => string;
}

/** One maintainer tab per shipped data file, in tab order. */
const DATA_FILES: readonly DataFileTab[] = [
  {
    tab: "items",
    file: "db-items.json",
    render: (exporter, composed) => exporter.toItemsFile(composed.items),
  },
  {
    tab: "bonuses",
    file: "db-bonuses.json",
    render: (exporter, composed) => exporter.toBonusesFile(composed.bonuses),
  },
  {
    tab: "slots",
    file: "slots.json",
    render: (exporter, composed) =>
      exporter.toSlotsFile(
        composed.sections,
        composed.slots,
        composed.sectionPresets,
      ),
  },
  {
    tab: "filters",
    file: "filters.json",
    render: (exporter, composed) => exporter.toFiltersFile(composed.filters),
  },
];

/** The tab actually in effect: the maintainer tabs collapse to "overlay" while the flag is
 *  off, even if `activeTab` was left pointing at one of them (e.g. remembered from an
 *  earlier session, or restored from a stale URL). */
const effectiveTab = computed(() =>
  maintainerTabsEnabled.value ? activeTab.value : "overlay",
);

/** The data file the active tab stands for, or null on the "This layer" tab. */
const dataFileTab = computed(
  () => DATA_FILES.find((entry) => entry.tab === effectiveTab.value) ?? null,
);

// Fetched only once a maintainer tab is actually in effect, so a reader who never turns the
// flag on never pays for `catalogExport.ts`: it stays a chunk of its own that the page does
// not request.
const catalogExport = ref<CatalogExportModule | null>(null);
const writeback = ref<WritebackModule | null>(null);
watchEffect(() => {
  if (effectiveTab.value === "overlay" || catalogExport.value) return;
  import("../../data/catalogExport").then((mod) => {
    catalogExport.value = mod;
  });
  import("../../data/writeback").then((mod) => {
    writeback.value = mod;
  });
});

const exportText = computed(() => {
  const entry = dataFileTab.value;
  // "This layer": raw overlay JSON.
  if (!entry) return JSON.stringify(props.overlay, null, 2);
  if (!catalogExport.value) return "Loading…";
  return entry.render(
    catalogExport.value,
    catalog.compose(layers.enabledOverlays.value),
  );
});

const exportName = computed(
  () => dataFileTab.value?.file ?? "catalog-overlay.json",
);

async function copyExport() {
  try {
    await navigator.clipboard.writeText(exportText.value);
    emit("notice", `Copied ${exportName.value} to the clipboard`);
  } catch {
    emit("notice", "Clipboard blocked - select the text and copy it manually");
  }
}

/** Outcome of the last send. Shown in the modal rather than as a notice behind it,
 *  since an unreachable server is started and retried from here. Cleared on a tab change so
 *  it can never describe a file other than the one on screen. */
const saveStatus = ref<{ ok: boolean; message: string } | null>(null);
const saving = ref(false);

watch(effectiveTab, () => {
  saveStatus.value = null;
});

async function sendToLocalServer() {
  const module = writeback.value;
  if (!module || saving.value) return;
  saving.value = true;
  saveStatus.value = null;
  try {
    const { repo } = await module.writeDataFile(
      exportName.value,
      exportText.value,
    );
    saveStatus.value = {
      ok: true,
      message: `Wrote ${exportName.value} to ${repo}`,
    };
  } catch (error) {
    saveStatus.value = {
      ok: false,
      message:
        error instanceof Error
          ? error.message
          : `Writing ${exportName.value} failed`,
    };
  } finally {
    saving.value = false;
  }
}

function downloadExport() {
  const blob = new Blob([exportText.value], { type: "text/plain" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = exportName.value;
  link.click();
  URL.revokeObjectURL(url);
}
</script>

<template>
  <BaseModal
    title="Export"
    panel-class="max-h-[85vh] w-[880px] max-w-[92vw]"
    data-testid="layer-export"
    @close="emit('close')"
  >
    <div class="flex min-h-0 flex-1 flex-col overflow-y-auto p-4">
      <div class="mb-1.5 flex flex-wrap items-end gap-2">
        <TabStrip>
          <TabButton
            :active="effectiveTab === 'overlay'"
            @click="activeTab = 'overlay'"
            >This layer</TabButton
          >
          <template v-if="maintainerTabsEnabled">
            <TabButton
              v-for="entry in DATA_FILES"
              :key="entry.tab"
              :active="effectiveTab === entry.tab"
              @click="activeTab = entry.tab"
              >{{ entry.file }}</TabButton
            >
          </template>
        </TabStrip>
        <span class="flex-1"></span>
        <BaseButton @click="copyExport"><Copy />Copy</BaseButton>
        <BaseButton @click="downloadExport"><Download />Download</BaseButton>
        <BaseTooltip
          v-if="effectiveTab !== 'overlay'"
          :text="`Writes ${exportName} into the repo through the local server started by \`npm run dev\` or \`npm run data-server\`.`"
        >
          <BaseButton
            :disabled="saving || !writeback"
            data-testid="layer-export-save"
            @click="sendToLocalServer"
            ><Save />{{
              saving ? "Sending…" : "Send to local server"
            }}</BaseButton
          >
        </BaseTooltip>
      </div>
      <CodeBlock :value="exportText" :rows="20" class="w-full" />
      <p
        v-if="saveStatus"
        class="mt-1"
        :class="saveStatus.ok ? 'text-muted' : 'text-danger'"
        data-testid="layer-export-save-status"
      >
        {{ saveStatus.message }}
      </p>
      <p class="mt-1 text-muted">
        <template v-if="effectiveTab === 'overlay'">
          Raw overlay JSON for this layer.
        </template>
        <template v-else>
          Composed from the base files and all enabled layers.
        </template>
      </p>
    </div>
  </BaseModal>
</template>
