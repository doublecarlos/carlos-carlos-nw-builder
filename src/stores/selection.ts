// Which build or layer is selected. Held in sessionStorage so two tabs can sit on
// different items. A fresh tab seeds from meta.lastSelection; every change writes
// both meta and sessionStorage.
import { computed, ref, shallowRef } from "vue";
import { afterPaint } from "../lib/after-paint";
import * as landing from "./landing";
import { persistMeta as persistMetaOrder } from "./meta";
import type { Selection } from "../types";

const SESSION_KEY = "nw:selection";

function readSession(): Selection | null {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (
      parsed &&
      typeof parsed === "object" &&
      (parsed.kind === "build" || parsed.kind === "layer") &&
      typeof parsed.id === "string"
    ) {
      return parsed as Selection;
    }
    return null;
  } catch {
    return null;
  }
}

function writeSession(sel: Selection | null) {
  try {
    if (sel) sessionStorage.setItem(SESSION_KEY, JSON.stringify(sel));
    else sessionStorage.removeItem(SESSION_KEY);
  } catch {
    // quota / private browsing - non-critical
  }
}

const _selection = ref<Selection | null>(readSession());

/** A nav pick already lit in the sidebar while the editor switch waits for the next paint.
 *  Shallow so the identity check in `pick` sees the object it stored, not a proxy of it. */
const _pending = shallowRef<Selection | null>(null);

export const selection = computed(() => _selection.value);

/** What the nav highlights: the pick in flight if there is one, else the selection. */
export const highlighted = computed(() => _pending.value ?? _selection.value);

function persistMeta() {
  persistMetaOrder(_selection.value);
}

// Picking something to look at is the one thing every way off the landing screen has in
// common -- a build created, a file imported, a loadout read out of the game, a restore from
// trash -- so the builder is revealed here rather than at each of those call sites. The
// `_restore*` seeds below deliberately do not: they run during boot, before the landing
// screen has had its say.

function select(sel: Selection) {
  _pending.value = null;
  _selection.value = sel;
  landing.enterBuilder();
  writeSession(sel);
  persistMeta();
}

export function selectBuild(id: string) {
  select({ kind: "build", id });
}

export function selectLayer(id: string) {
  select({ kind: "layer", id });
}

// A nav row click selects in two steps so the highlight never waits on the heavier render:
// the row lights up in the same frame as its focus outline, and the editor, with the engine
// work behind it, follows once that frame has painted. Any select in between supersedes a
// pick still in flight.
function pick(sel: Selection) {
  _pending.value = sel;
  afterPaint(() => {
    if (_pending.value === sel) select(sel);
  });
}

export function pickBuild(id: string) {
  pick({ kind: "build", id });
}

export function pickLayer(id: string) {
  pick({ kind: "layer", id });
}

export function clearSelection() {
  _pending.value = null;
  _selection.value = null;
  writeSession(null);
  persistMeta();
}

/** Seed from meta on first load - called by bootstrap. Does not overwrite a value that
 * already exists in sessionStorage (survives a page reload in the same tab). */
export function _restoreFromMeta(fallback: Selection | null) {
  if (_selection.value) return;
  if (fallback) {
    _selection.value = fallback;
    writeSession(fallback);
  }
}

/** Apply a route after stores are populated - called by bootstrap. */
export function _restoreFromRoute(buildId?: string, layerId?: string) {
  if (buildId) {
    _selection.value = { kind: "build", id: buildId };
  } else if (layerId) {
    _selection.value = { kind: "layer", id: layerId };
  }
  if (buildId || layerId) writeSession(_selection.value);
}
