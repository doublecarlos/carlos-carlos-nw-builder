<script setup lang="ts">
// Full-width header bar: app title, export/import, an auto-save indicator, theme toggle,
// notice, and the About/shortcut overlays.
//
// Below lg it stays one row: `headerLayout` moves whatever does not fit into an overflow menu,
// the title shrinks to its mark on a phone, and a notice drops onto a row of its own. From lg up
// a notice takes only the bar's spare width.
import { computed, ref, useTemplateRef, type Component } from "vue";
import ThemeToggle, { THEME_ICONS, THEME_LABELS } from "./ui/ThemeToggle.vue";
import BaseButton from "./ui/BaseButton.vue";
import BaseLink from "./ui/BaseLink.vue";
import BaseMenu from "./ui/BaseMenu.vue";
import BaseMenuItem from "./ui/BaseMenuItem.vue";
import BaseNotice from "./ui/BaseNotice.vue";
import AboutDialog from "./AboutDialog.vue";
import AutosaveIndicator from "./AutosaveIndicator.vue";
import BundleExport from "./BundleExport.vue";
import GameImport from "./GameImport.vue";
import ImportPicker from "./ImportPicker.vue";
import ShortcutHelp from "./ShortcutHelp.vue";
import StableBrowser from "./game/StableBrowser.vue";
import NavContextMenu from "./NavContextMenu.vue";
import {
  Download,
  EllipsisVertical,
  Gamepad2,
  Info,
  Keyboard,
  Menu,
  Search,
  Table,
  Upload,
  Wrench,
} from "@lucide/vue";
import { importFileText, pending as pendingImport } from "../stores/importFile";
import { notice, noticeAction, showNotice } from "../stores/notice";
import {
  isOpen as gameImportOpen,
  openWizard as openGameImport,
} from "../stores/gameImport";
import * as shortcutHelp from "../stores/shortcutHelp";
import * as goTo from "../stores/goTo";
import * as stableBrowser from "../stores/stableBrowser";
import * as builds from "../stores/builds";
import * as engine from "../stores/resolved";
import { mountSlotId } from "../engine/insignia";
import * as buildEditor from "../stores/buildEditor";
import * as layerEditorUi from "../stores/layerEditorUi";
import * as landing from "../stores/landing";
import * as shell from "../stores/shell";
import * as viewport from "../stores/viewport";
import { preference, cyclePreference } from "../stores/theme";
import GoToPalette from "./GoToPalette.vue";
import { APP_NAME } from "../lib/app-info";
import { isMac } from "../lib/platform";
import { viewportKind } from "../lib/shell-layout";
import { headerLayout, type HeaderAction } from "../lib/header-layout";

const importFileInput = useTemplateRef("importFileInput");
const modKey = isMac ? "⌘" : "Ctrl";
const showBundleExport = ref(false);
const showAbout = ref(false);

/** The nav exists only inside the builder, never over the loading or landing screens. */
const navAvailable = computed(
  () => !builds.loading.value && !landing.showing.value,
);

function triggerExportBundle() {
  showBundleExport.value = true;
}

function triggerImport() {
  importFileInput.value?.click();
}

const toolsOrigin = ref<{ anchor: DOMRect; trigger: HTMLElement } | null>(null);

const TOOLS = [
  { action: "stable", label: "Mount stable reference", icon: Table },
];

function toggleTools(event: MouseEvent) {
  if (toolsOrigin.value) {
    toolsOrigin.value = null;
    return;
  }
  const trigger = event.currentTarget as HTMLElement;
  toolsOrigin.value = { anchor: trigger.getBoundingClientRect(), trigger };
}

function onTool(action: string) {
  toolsOrigin.value = null;
  if (action === "stable") stableBrowser.openReference();
}

const layout = computed(() =>
  headerLayout(
    viewportKind(viewport.isDesktop.value, viewport.isPhone.value),
    viewport.coarsePointer.value,
  ),
);
const inBar = (action: HeaderAction) => layout.value.bar.has(action);

interface MenuEntry {
  label: string;
  icon: Component;
  run: () => void;
  /** Stays open after the click, for an entry worth pressing more than once. */
  keepOpen?: boolean;
}

/** Each action as an overflow menu entry; its bar markup is in the template. */
const menuEntries = computed<Record<HeaderAction, MenuEntry>>(() => ({
  export: { label: "Export", icon: Download, run: triggerExportBundle },
  import: { label: "Import", icon: Upload, run: triggerImport },
  importFromGame: {
    label: "Import from game",
    icon: Gamepad2,
    run: openGameImport,
  },
  stable: {
    label: "Mount stable reference",
    icon: Table,
    run: () => stableBrowser.openReference(),
  },
  shortcuts: {
    label: "Keyboard shortcuts",
    icon: Keyboard,
    run: () => shortcutHelp.toggle(),
  },
  about: {
    label: "About",
    icon: Info,
    run: () => (showAbout.value = true),
  },
  theme: {
    label: THEME_LABELS[preference.value],
    icon: THEME_ICONS[preference.value],
    run: cyclePreference,
    keepOpen: true,
  },
}));

const overflowMenu = useTemplateRef("overflowMenu");

/** Closes first, so a dialog the entry opens takes the menu trigger as its focus return. */
function onMenuEntry(action: HeaderAction) {
  const entry = menuEntries.value[action];
  if (!entry.keepOpen) overflowMenu.value?.close();
  entry.run();
}

function applyStableMount(applied: { group: number; mount: string }) {
  const slotId = mountSlotId(engine.db.value, applied.group);
  if (slotId) buildEditor.setChoice(slotId, applied.mount);
}

function createStableItem(filter: string) {
  void layerEditorUi.openNewItem({ id: "", name: "", filter });
}

async function onImportFile(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = "";
  if (!file) return;
  importFileText(await file.text(), file.name);
}
</script>

<template>
  <!-- Wraps only below lg, and only to give a notice a row of its own. No label wraps, so a
       crowded bar never grows taller. The padding clears a phone's notch and rounded corners;
       the insets are zero everywhere else. -->
  <header
    class="flex items-center gap-2.5 whitespace-nowrap border-b border-line bg-surface pt-[max(0.5rem,env(safe-area-inset-top))] pr-[max(0.5rem,env(safe-area-inset-right))] pb-2 pl-[max(0.5rem,env(safe-area-inset-left))] max-lg:flow-wrap"
    data-testid="app-header"
  >
    <!-- Below lg the nav lives in a drawer, and this is the way in. -->
    <BaseButton
      v-if="navAvailable"
      class="lg:hidden"
      data-testid="header-nav-toggle"
      aria-label="Builds and layers"
      aria-haspopup="dialog"
      :aria-expanded="shell.navDrawerOpen.value"
      @click="shell.openNavDrawer()"
      ><Menu
    /></BaseButton>

    <!-- The one item here that may shrink. Every other child is a control with a fixed
         intrinsic width, so without this the bar's own minimum grows with each one added and
         a narrow window scrolls sideways. A phone keeps only the mark. -->
    <h1
      class="flex min-w-0 items-center text-base font-semibold tracking-wide"
      data-testid="header-title"
    >
      <img
        class="inline flex-none"
        src="/icon-512.png"
        alt=""
        width="32"
        height="32"
      />
      <span class="min-w-0 flex-1 truncate max-md:sr-only">{{ APP_NAME }}</span>
    </h1>

    <BaseButton
      v-if="inBar('export')"
      data-testid="header-export-bundle"
      @click="triggerExportBundle"
      ><Download />Export</BaseButton
    >
    <BundleExport v-if="showBundleExport" @close="showBundleExport = false" />

    <!-- The app's only file entry point, so it says what it takes: `importFileText` sniffs
         the file and routes it, rather than the caller picking a kind up front. -->
    <BaseButton
      v-if="inBar('import')"
      title="Import a build, layer or bundle file."
      data-testid="header-import"
      @click="triggerImport"
      ><Upload />Import</BaseButton
    >

    <!-- Mounted here for every entry point, as the game-import wizard is. -->
    <ImportPicker v-if="pendingImport" :plan="pendingImport" />

    <BaseButton
      v-if="inBar('importFromGame')"
      data-testid="header-import-from-game"
      @click="openGameImport"
      ><Gamepad2 />Import from game</BaseButton
    >
    <GameImport v-if="gameImportOpen" />

    <BaseButton
      v-if="inBar('stable')"
      data-testid="header-tools"
      aria-haspopup="menu"
      :aria-expanded="!!toolsOrigin"
      @click="toggleTools"
      ><Wrench />Tools</BaseButton
    >
    <NavContextMenu
      v-if="toolsOrigin"
      :origin="toolsOrigin"
      align="left"
      :items="TOOLS"
      :ignore="['[data-testid=header-tools]']"
      @action="onTool"
      @close="toolsOrigin = null"
    />
    <!-- Mounted here rather than in the editor: the reference is worth reading with no build
         open, and one instance serves both ways in. -->
    <StableBrowser
      v-if="stableBrowser.isOpen.value"
      :db="engine.db.value"
      :build="builds.build.value"
      :group="stableBrowser.group.value"
      @close="stableBrowser.close()"
      @apply="applyStableMount"
      @create="createStableItem"
    />

    <input
      ref="importFileInput"
      type="file"
      accept=".json,application/json"
      class="hidden"
      @change="onImportFile"
    />

    <span class="h-4 w-px bg-line max-md:hidden" />

    <!-- Shaped like the search box it opens, rather than an icon button: a palette nobody
         knows the shortcut for is a palette nobody uses, so the affordance states the binding
         it is standing in for. A phone has no room for the box and a touch screen has no
         keyboard for the binding, so each drops the part it cannot use. -->
    <button
      type="button"
      class="flex flex-none cursor-pointer items-center justify-center gap-1.5 rounded-md border border-line bg-surface px-1.5 py-0.5 text-muted hover:border-accent hover:text-text max-md:border-transparent"
      data-testid="header-go-to"
      @click="goTo.open()"
    >
      <Search class="h-[14px] w-[14px]" />
      <span class="max-md:sr-only">Go to…</span>
      <kbd
        class="rounded border border-line bg-surface-2 px-1 text-xs whitespace-nowrap max-md:hidden pointer-coarse:hidden"
        >{{ modKey }}+K</kbd
      >
    </button>
    <GoToPalette v-if="goTo.isOpen.value" />

    <span class="h-4 w-px bg-line max-md:hidden" />

    <AutosaveIndicator />

    <!-- From lg up this is the bar's spacer: the notice fills only the width left over and
         truncates, so showing one never moves or squeezes another control. `:title` keeps the
         full text. Below lg the notice takes a full row of its own and wraps there instead. -->
    <span
      class="relative flex min-w-0 items-center gap-1 max-lg:order-last max-lg:basis-full lg:flex-1"
      :class="notice ? undefined : 'max-lg:hidden'"
      data-testid="header-notice"
    >
      <!-- Keyed by text, so a replacing notice enters again. The leaving one drops out of flow
           so the new one takes its place at once. -->
      <Transition
        enter-active-class="transition duration-150 ease-snappy"
        enter-from-class="opacity-0 translate-y-1"
        leave-active-class="absolute transition-opacity duration-100"
        leave-to-class="opacity-0"
      >
        <BaseNotice
          v-if="notice"
          :key="notice"
          class="inline-block min-w-0 max-lg:whitespace-normal lg:max-w-[32rem] lg:overflow-hidden lg:text-ellipsis"
          :title="notice"
          @dismiss="showNotice('')"
        >
          {{ notice }}
        </BaseNotice>
      </Transition>
      <BaseLink
        v-if="notice && noticeAction"
        class="flex-none"
        data-testid="notice-action"
        @click="noticeAction.run()"
        >{{ noticeAction.label }}</BaseLink
      >
    </span>

    <span class="flex-1 lg:hidden"></span>

    <span
      v-if="inBar('shortcuts') || inBar('about')"
      class="h-4 w-px bg-line"
    />

    <BaseButton
      v-if="inBar('shortcuts')"
      title="Keyboard shortcuts (?)"
      data-testid="header-shortcuts"
      aria-label="Keyboard shortcuts"
      @click="shortcutHelp.toggle()"
      ><Keyboard
    /></BaseButton>

    <BaseButton
      v-if="inBar('about')"
      title="About"
      data-testid="header-about"
      aria-label="About"
      @click="showAbout = true"
      ><Info
    /></BaseButton>

    <ThemeToggle v-if="inBar('theme')" />

    <BaseMenu
      v-if="layout.menu.length"
      ref="overflowMenu"
      fit-content
      label="More actions"
      panel-class="flex min-w-48 flex-col p-1"
      :ignore="['[data-testid=header-menu]']"
    >
      <template #trigger="{ toggle, attrs }">
        <BaseButton
          data-testid="header-menu"
          aria-label="More actions"
          v-bind="attrs"
          @click="toggle"
          ><EllipsisVertical
        /></BaseButton>
      </template>
      <BaseMenuItem
        v-for="action in layout.menu"
        :key="action"
        :icon="menuEntries[action].icon"
        :data-testid="`header-menu-${action}`"
        @click="onMenuEntry(action)"
        >{{ menuEntries[action].label }}</BaseMenuItem
      >
    </BaseMenu>

    <ShortcutHelp v-if="shortcutHelp.isOpen.value" />
    <AboutDialog v-if="showAbout" @close="showAbout = false" />
  </header>
</template>
