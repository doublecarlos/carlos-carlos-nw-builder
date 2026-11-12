import { computed } from "vue";
import { expandSlots } from "../lib/item-picker-list";
import { slotShown } from "../lib/slot-availability";
import { isLayoutRow } from "../lib/row-visibility";
import { itemLabel } from "../engine/insignia";
import type { GoToEntry } from "../lib/go-to";
import * as engine from "../stores/resolved";
import * as builds from "../stores/builds";
import * as folders from "../stores/folders";
import * as layers from "../stores/layers";

/**
 * Everything the "go to" palette can take you to, in the order it reads when nothing has been
 * typed: sections, then their slots, then builds, then layers.
 *
 * The slot list mirrors what BuildEditor.vue actually renders (`allSlotsBySection`): no
 * separators or text rows, since neither is a place the cursor can land, no `quick` slot (it
 * lives in the QuickOptions strip, not in a section) and no unavailable slot. Offering a target
 * the editor has no row for is worse than not offering it. For the same reason a section with
 * no field the editor shows is left out, as the editor hides it.
 */
export function useGoToEntries() {
  return computed<GoToEntry[]>(() => {
    const entries: GoToEntry[] = [];
    const resolved = engine.resolved.value;
    const active = builds.build.value;
    if (resolved.ok && active) {
      const db = engine.db.value;
      const itemBySlot = new Map(
        resolved.result.rows.map((row) => [row.slotId, row.item]),
      );
      const slots = expandSlots(db.slots, active).filter((slotDef) =>
        slotShown(slotDef, resolved.result.hiddenSlots),
      );
      const isQuick = (slotDef: (typeof slots)[number]) =>
        (slotDef.type === "build_parameter" ||
          slotDef.type === "item_picker") &&
        !!slotDef.quick;
      const withFields = new Set(
        slots
          .filter((slotDef) => !isLayoutRow(slotDef) && !isQuick(slotDef))
          .map((slotDef) => slotDef.section),
      );
      for (const section of db.sections) {
        if (!withFields.has(section.id)) continue;
        entries.push({
          key: `section:${section.id}`,
          kind: "section",
          id: section.id,
          label: section.label,
        });
      }
      for (const section of db.sections) {
        for (const slotDef of slots) {
          if (slotDef.section !== section.id) continue;
          if (isLayoutRow(slotDef) || slotDef.type === "item_picker_list")
            continue;
          if (isQuick(slotDef)) continue;
          const item = itemBySlot.get(slotDef.id);
          entries.push({
            key: `slot:${slotDef.id}`,
            kind: "slot",
            id: slotDef.id,
            sectionId: section.id,
            label: slotDef.label ?? slotDef.id,
            // What the row itself shows, so the palette doubles as "what have I got in there".
            detail: item
              ? `${section.label} · ${itemLabel(db, item)}`
              : section.label,
          });
        }
      }
    }
    for (const build of builds.builds.value) {
      entries.push({
        key: `build:${build.id}`,
        kind: "build",
        id: build.id,
        label: build.name,
        // Same disambiguation the build pickers show: two builds can share a name across
        // folders, and the palette lists them with nothing else to tell them apart.
        detail: folders.pathOf(build.id),
      });
    }
    for (const layer of layers.layers.value) {
      entries.push({
        key: `layer:${layer.id}`,
        kind: "layer",
        id: layer.id,
        label: layer.name,
      });
    }
    return entries;
  });
}
