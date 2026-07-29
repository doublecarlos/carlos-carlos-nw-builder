// Every mutation that writes the active build's *content* goes through here, and every one of
// them takes a snapshot first -- this is the one place undo has to watch.
import { computed, reactive, watch } from 'vue';
import * as format from '../format';
import * as storage from '../storage';
import * as library from './library';
import * as compare from './compare';
import { db } from './engine';

interface HistoryEntry { json: string; label: string; }
interface BuildHistory { past: HistoryEntry[]; future: HistoryEntry[]; lastKey: string | null; lastAt: number; }

const UNDO_LIMIT = 50;
// Consecutive edits of the same thing inside this window collapse into one undo step, so
// typing 3589 into a number field is one undo, not four.
const COALESCE_MS = 700;

// Context keys whose title-cased name would read oddly in an undo tooltip.
const FIELD_LABELS: Record<string, string> = {
  combatType: 'Combat type',
  damageType: 'Damage type',
  m32Forte: 'M32 Forte',
  duration: 'Duration (s)',
};

const FORTE_LABELS: Record<string, string> = { primary: 'Forte 1', secondaryA: 'Forte 2A', secondaryB: 'Forte 2B' };

// buildId -> { past, future, … } of JSON snapshots. Per build, so switching away and back
// preserves what you could undo. Never persisted: history is a session concept.
const histories = reactive<Record<string, BuildHistory>>({});

// A deleted build's history would otherwise sit in memory forever -- prune whenever the pool
// changes shape (library.ts owns removal; this just reacts to the result).
watch(() => library.builds.value.map((b) => b.id), (ids) => {
  const live = new Set(ids);
  for (const id of Object.keys(histories)) if (!live.has(id)) delete histories[id];
});

function historyFor(id: string = library.activeId.value) {
  let history = histories[id];
  if (!history) {
    history = { past: [], future: [], lastKey: null, lastAt: 0 };
    histories[id] = history;
  }
  return history;
}

export const canUndo = computed(() => (histories[library.activeId.value]?.past.length ?? 0) > 0);
export const canRedo = computed(() => (histories[library.activeId.value]?.future.length ?? 0) > 0);

/** What the buttons would actually reverse, for their tooltips. */
export const undoLabel = computed(() => {
  const past = histories[library.activeId.value]?.past;
  return past?.length ? past[past.length - 1].label : '';
});

export const redoLabel = computed(() => {
  const future = histories[library.activeId.value]?.future;
  return future?.length ? future[future.length - 1].label : '';
});

/**
 * Record the build as it is *before* a change. `key` identifies the thing being edited so
 * repeated edits of one field coalesce; pass a unique key (or `null`) to force a distinct step.
 * `label` describes the change in the user's words and ends up in the undo tooltip.
 */
function snapshot(key: string | null, label: string) {
  const history = historyFor();
  const now = Date.now();
  const coalesce = key != null
    && key === history.lastKey
    && now - history.lastAt < COALESCE_MS
    && history.past.length > 0;

  if (!coalesce) {
    history.past.push({ json: JSON.stringify(library.build.value), label });
    if (history.past.length > UNDO_LIMIT) history.past.shift();
  }
  history.lastKey = key;
  history.lastAt = now;
  history.future.length = 0;
}

/** Slot ids are internal; the tooltip should say "Ring 1", not "gear.ring1". */
function slotLabel(slotId: string) {
  return db.value.slotById.get(slotId)?.label ?? slotId;
}

export function undo() {
  if (!canUndo.value) return;
  const history = historyFor();
  const entry = history.past.pop()!;  // non-null: canUndo.value already confirmed past.length > 0
  history.future.push({ json: JSON.stringify(library.build.value), label: entry.label });
  library.replaceActive(JSON.parse(entry.json));
  history.lastKey = null;
}

export function redo() {
  if (!canRedo.value) return;
  const history = historyFor();
  const entry = history.future.pop()!;  // non-null: canRedo.value already confirmed future.length > 0
  history.past.push({ json: JSON.stringify(library.build.value), label: entry.label });
  library.replaceActive(JSON.parse(entry.json));
  history.lastKey = null;
}

// --- build content edits --------------------------------------------------------------------

export function setChoice(slotId: string, name: string) {
  const slot = slotLabel(slotId);
  snapshot(`choice:${slotId}`, name ? `${slot} → ${name}` : `clear ${slot}`);
  const build = library.activeBuildForEdit();
  if (name) {
    build.choices[slotId] = name;
  } else {
    delete build.choices[slotId];
    delete build.values[slotId];
  }
}

export function setValue(slotId: string, raw: string) {
  snapshot(`value:${slotId}`, `${slotLabel(slotId)} value`);
  const build = library.activeBuildForEdit();
  if (raw === '' || raw == null) delete build.values[slotId];
  else build.values[slotId] = Number(raw);
}

/** The quick-compare picker's row: this build's slot made to match the compare build's,
 * choice and typed value together, in one undo step. Silently no-ops with nothing selected
 * to compare against -- the "apply" link only exists on a row a compare build already lights up. */
export function applyFromCompare(slotId: string) {
  const other = compare.compareBuild.value;
  if (!other) return;
  const slot = slotLabel(slotId);
  const name = other.choices[slotId] || '';
  snapshot(`choice:${slotId}`,
    name ? `${slot} → ${name} (from “${other.name}”)` : `clear ${slot} (from “${other.name}”)`);
  const build = library.activeBuildForEdit();
  if (name) {
    build.choices[slotId] = name;
    const value = other.values?.[slotId];
    if (value != null) build.values[slotId] = value;
    else delete build.values[slotId];
  } else {
    delete build.choices[slotId];
    delete build.values[slotId];
  }
}

/** Copies just the compare build's magnitude for a slot whose item already matches --
 * `applyFromCompare` above copies choice and value together, which would be the wrong tool
 * here since the item is not what differs. */
export function applyValueFromCompare(slotId: string) {
  const other = compare.compareBuild.value;
  if (!other) return;
  const slot = slotLabel(slotId);
  const value = other.values?.[slotId];
  snapshot(`value:${slotId}`, `${slot} value → ${value ?? '(none)'} (from “${other.name}”)`);
  const build = library.activeBuildForEdit();
  if (value != null) build.values[slotId] = value;
  else delete build.values[slotId];
}

export function setContext(key: string, value: string | number | boolean) {
  const name = FIELD_LABELS[key] ?? format.titleCase(key);
  const shown = typeof value === 'boolean'
    ? (value ? 'on' : 'off')
    : format.titleCase(String(value));
  snapshot(`context:${key}`, `${name} → ${shown}`);
  (library.activeBuildForEdit().context as unknown as Record<string, string | number | boolean>)[key] = value;
}

export function setToggle(name: string, value: boolean) {
  snapshot(`toggle:${name}`, `${format.titleCase(name)} ${value ? 'on' : 'off'}`);
  library.activeBuildForEdit().context.toggles[name] = value;
}

export function setForte(slot: string, statKey: string) {
  const target = statKey ? format.label(statKey) : 'none';
  snapshot(`forte:${slot}`, `${FORTE_LABELS[slot] ?? slot} → ${target}`);
  const forte = library.activeBuildForEdit().context.forte as unknown as Record<string, string | undefined>;
  if (statKey) forte[slot] = statKey;
  else delete forte[slot];
}

export function renameBuild(name: string) {
  snapshot('name', 'rename build');
  library.activeBuildForEdit().name = name;
}

export const filledSlots = computed(() => Object.values(library.build.value.choices).filter(Boolean).length);

export function clearSlots() {
  snapshot(null, `clear all ${filledSlots.value} slots`);
  const build = library.activeBuildForEdit();
  build.choices = {};
  build.values = {};
}

export function resetAll() {
  snapshot(null, 'reset build');
  const fresh = storage.defaultBuild(library.build.value.name);
  fresh.id = library.build.value.id;
  library.replaceActive(fresh);
}

/**
 * Slot-id keyed, so it cannot misalign the way a spreadsheet range paste can. Slots the
 * source leaves empty are cleared in the target -- "copy this section" means the section
 * ends up matching, not "merge whatever happens to be set".
 */
export function copySection(fromId: string, sectionIds: string[]) {
  const source = library.builds.value.find((item) => item.id === fromId);
  if (!source) return;

  snapshot(null, `copy ${sectionIds.length} section(s) from “${source.name}”`);
  const build = library.activeBuildForEdit();
  const wanted = new Set(sectionIds);
  for (const slot of db.value.slots) {
    if (!wanted.has(slot.section)) continue;

    const choice = source.choices[slot.id];
    if (choice) build.choices[slot.id] = choice;
    else delete build.choices[slot.id];

    const value = source.values[slot.id];
    if (value != null) build.values[slot.id] = value;
    else delete build.values[slot.id];
  }
}

/** One slot's own "revert" icon: undoes just that slot's unsaved edit, leaving the rest of
 * the draft alone -- unlike `revertActive`, which throws away everything unsaved in the build. */
export function revertSlot(slotId: string) {
  const saved = library.savedById.value[library.activeId.value];
  if (!saved) return;
  snapshot(null, `revert ${slotLabel(slotId)}`);
  const build = library.activeBuildForEdit();
  const choice = saved.choices[slotId];
  if (choice) build.choices[slotId] = choice;
  else delete build.choices[slotId];
  const value = saved.values[slotId];
  if (value != null) build.values[slotId] = value;
  else delete build.values[slotId];
}

/** Same, for every slot in one section at once (a section header's own "revert" icon). */
export function revertSection(sectionId: string) {
  const saved = library.savedById.value[library.activeId.value];
  const slots = db.value.slots.filter((slot) => slot.section === sectionId);
  if (!saved || !slots.length) return;
  const label = db.value.sections.find((section) => section.id === sectionId)?.label ?? sectionId;
  snapshot(null, `revert ${label}`);
  const build = library.activeBuildForEdit();
  for (const slot of slots) {
    const choice = saved.choices[slot.id];
    if (choice) build.choices[slot.id] = choice;
    else delete build.choices[slot.id];
    const value = saved.values[slot.id];
    if (value != null) build.values[slot.id] = value;
    else delete build.values[slot.id];
  }
}

/** The Save button: promotes the live draft to the saved library. */
export function saveActive() {
  library.markBuildSaved(library.activeId.value, { ...storage.cloneBuild(library.build.value), updated: Date.now() });
}

/** Discards unsaved edits back to what was last saved. BuildBar.vue gates this behind its
 * own two-step confirm, same as delete -- this is the one place an ordinary edit can be lost,
 * since the draft otherwise survives everything (including a reload). */
export function revertActive() {
  const saved = library.savedById.value[library.activeId.value];
  if (!saved) return;
  snapshot(null, 'revert unsaved changes');
  library.replaceActive(storage.cloneBuild(saved));
}
