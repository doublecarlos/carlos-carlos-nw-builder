// Which build or layer is selected. Held in sessionStorage so two tabs can sit on
// different items. A fresh tab seeds from meta.lastSelection; every change writes
// both meta and sessionStorage.
import { computed, ref } from "vue";
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
    // quota / private browsing — non-critical
  }
}

const _selection = ref<Selection | null>(readSession());

export const selection = computed(() => _selection.value);

function persistMeta() {
  persistMetaOrder(_selection.value);
}

export function selectBuild(id: string) {
  _selection.value = { kind: "build", id };
  writeSession(_selection.value);
  persistMeta();
}

export function selectLayer(id: string) {
  _selection.value = { kind: "layer", id };
  writeSession(_selection.value);
  persistMeta();
}

export function clearSelection() {
  _selection.value = null;
  writeSession(null);
  persistMeta();
}

/** Seed from meta on first load — called by bootstrap. Does not overwrite a value that
 * already exists in sessionStorage (survives a page reload in the same tab). */
export function _restoreFromMeta(fallback: Selection | null) {
  if (_selection.value) return;
  if (fallback) {
    _selection.value = fallback;
    writeSession(fallback);
  }
}

/** Apply a route after stores are populated — called by bootstrap. */
export function _restoreFromRoute(buildId?: string, layerId?: string) {
  if (buildId) {
    _selection.value = { kind: "build", id: buildId };
  } else if (layerId) {
    _selection.value = { kind: "layer", id: layerId };
  }
  if (buildId || layerId) writeSession(_selection.value);
}
