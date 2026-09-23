// The Slots tab's left pane as data: the composed layout as an ordered tree of sections, each
// with its slots in render order and the presets that target it.
//
// Pure, so it is testable without a DOM. Tombstones appear as `removed` rows so they can be
// restored, and slots whose section no longer exists go in a trailing bucket.
import * as catalog from "../data/catalog";
import { matchesQuery } from "./text-filter";
import type { CatalogOverlay, Db, SectionPreset, Slot } from "../types";
import type { EntryStatus } from "../data/catalog";

export type OutlineKind = "section" | "slot" | "sectionPreset";

export interface OutlineRow {
  key: string;
  kind: OutlineKind;
  name: string;
  /** The secondary column: a slot's type, or a section's slot count. */
  detail: string;
  status: EntryStatus;
}

export interface OutlineGroup {
  /** The section's own row, or null for the orphan bucket. */
  section: OutlineRow | null;
  /** The section's label, or the bucket's name. */
  label: string;
  slots: OutlineRow[];
  presets: OutlineRow[];
}

/** Slots whose `section` does not exist. `compose` still renders them last, and lint reports them. */
export const ORPHAN_LABEL = "No section";

/** A slot's row name: its label, a text slot's text, or else its id. */
const slotName = (slot: Slot) =>
  slot.label || (slot.type === "text" ? slot.text : "") || slot.id;

const slotRow = (slot: Slot, overlay: CatalogOverlay): OutlineRow => ({
  key: slot.id,
  kind: "slot",
  name: slotName(slot),
  detail: slot.type,
  status: catalog.statusOf(overlay, "slots", slot.id),
});

const presetRow = (
  preset: SectionPreset,
  overlay: CatalogOverlay,
): OutlineRow => ({
  key: preset.id,
  kind: "sectionPreset",
  name: preset.label || preset.id,
  detail: "",
  status: catalog.statusOf(overlay, "sectionPresets", preset.id),
});

/** The composed layout as a tree: sections and slots in layout order, presets by id. */
export function buildOutline(db: Db, overlay: CatalogOverlay): OutlineGroup[] {
  const shipped = catalog.base();
  const groups = new Map<string, OutlineGroup>();

  for (const section of db.sections) {
    groups.set(section.id, {
      section: {
        key: section.id,
        kind: "section",
        name: section.label || section.id,
        detail: "",
        status: catalog.statusOf(overlay, "sections", section.id),
      },
      label: section.label || section.id,
      slots: [],
      presets: [],
    });
  }
  // A removed section keeps its group, so it can be restored in place.
  for (const id of catalog.tombstoneIds(overlay, "sections")) {
    const name =
      shipped.sections.find((section) => section.id === id)?.label ?? id;
    groups.set(id, {
      section: {
        key: id,
        kind: "section",
        name,
        detail: "",
        status: "removed",
      },
      label: name,
      slots: [],
      presets: [],
    });
  }

  const orphans: OutlineGroup = {
    section: null,
    label: ORPHAN_LABEL,
    slots: [],
    presets: [],
  };
  const bucket = (sectionId: string) => groups.get(sectionId) ?? orphans;

  for (const slot of db.authoredSlots)
    bucket(slot.section).slots.push(slotRow(slot, overlay));
  for (const id of catalog.tombstoneIds(overlay, "slots")) {
    const base = shipped.slots.find((slot) => slot.id === id);
    bucket(base?.section ?? "").slots.push({
      key: id,
      kind: "slot",
      name: base ? slotName(base) : id,
      detail: base?.type ?? "",
      status: "removed",
    });
  }

  for (const preset of db.presets)
    bucket(preset.section).presets.push(presetRow(preset, overlay));
  for (const id of catalog.tombstoneIds(overlay, "sectionPresets")) {
    const base = shipped.sectionPresets.find((preset) => preset.id === id);
    bucket(base?.section ?? "").presets.push({
      key: id,
      kind: "sectionPreset",
      name: base?.label || id,
      detail: "",
      status: "removed",
    });
  }

  for (const group of groups.values()) {
    const count = group.slots.length;
    if (group.section && group.section.status !== "removed")
      group.section.detail = `${count} slot(s)`;
  }

  const out = [...groups.values()];
  if (orphans.slots.length || orphans.presets.length) out.push(orphans);
  return out;
}

export interface OutlineFilter {
  query: string;
  /** all | changed | added | edited | removed */
  status: string;
}

function passes(row: OutlineRow, filter: OutlineFilter): boolean {
  if (filter.status === "changed" && row.status === "base") return false;
  if (
    ["added", "edited", "removed"].includes(filter.status) &&
    row.status !== filter.status
  )
    return false;
  return matchesQuery([row.name, row.detail], filter.query);
}

/** The tree narrowed to matching rows, keeping any group with a match. */
export function filterOutline(
  groups: OutlineGroup[],
  filter: OutlineFilter,
): OutlineGroup[] {
  const out: OutlineGroup[] = [];
  for (const group of groups) {
    const slots = group.slots.filter((row) => passes(row, filter));
    const presets = group.presets.filter((row) => passes(row, filter));
    const sectionMatches = group.section
      ? passes(group.section, filter)
      : false;
    if (!slots.length && !presets.length && !sectionMatches) continue;
    out.push({ ...group, slots, presets });
  }
  return out;
}

/** The tree flattened top to bottom, in arrow key order. */
export function outlineRows(groups: OutlineGroup[]): OutlineRow[] {
  const rows: OutlineRow[] = [];
  for (const group of groups) {
    if (group.section) rows.push(group.section);
    rows.push(...group.slots, ...group.presets);
  }
  return rows;
}

/**
 * A reorder as an absolute destination in the composed layout: the entry's index after it is
 * removed from its current place, as `catalog.moveSlot`/`moveSection` take it.
 */
export type OutlineMove =
  | { kind: "section"; key: string; index: number }
  | { kind: "slot"; key: string; sectionId: string; index: number };
