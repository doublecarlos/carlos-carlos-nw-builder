import { computed } from "vue";
import { slotVisible } from "../lib/slot-visibility";
import { expandSlots } from "../lib/item-picker-list";
import type { GoToEntry } from "../lib/go-to";
import * as engine from "../stores/resolved";
import * as builds from "../stores/builds";
import * as layers from "../stores/layers";

/**
 * Everything the "go to" palette can take you to, in the order it reads when nothing has been
 * typed: sections, then their slots, then builds, then layers.
 *
 * The slot list mirrors what BuildEditor.vue actually renders (`allSlotsBySection`): no
 * separators or text rows, since neither is a place the cursor can land, no `quick` slot (it
 * lives in the QuickOptions strip, not in a section), and nothing hidden by its own
 * `visibleWhen`. Offering a target the editor has no row for is worse than not offering it.
 */
export function useGoToEntries() {
  return computed<GoToEntry[]>(() => {
    const entries: GoToEntry[] = [];
    const resolved = engine.resolved.value;
    if (resolved.ok) {
      const db = engine.db.value;
      const itemBySlot = new Map(
        resolved.result.rows.map((row) => [row.slotId, row.item]),
      );
      for (const section of db.sections) {
        entries.push({
          key: `section:${section.id}`,
          kind: "section",
          id: section.id,
          label: section.label,
        });
      }
      for (const section of db.sections) {
        for (const slotDef of expandSlots(db.slots, builds.build.value)) {
          if (slotDef.section !== section.id) continue;
          if (
            slotDef.type === "separator" ||
            slotDef.type === "text" ||
            slotDef.type === "item_picker_list"
          )
            continue;
          if (
            (slotDef.type === "build_parameter" ||
              slotDef.type === "item_picker") &&
            slotDef.quick
          )
            continue;
          if (!slotVisible(slotDef, resolved.result.context)) continue;
          const item = itemBySlot.get(slotDef.id);
          entries.push({
            key: `slot:${slotDef.id}`,
            kind: "slot",
            id: slotDef.id,
            sectionId: section.id,
            label: slotDef.label ?? slotDef.id,
            // What the row itself shows, so the palette doubles as "what have I got in there".
            detail: item ? `${section.label} · ${item.name}` : section.label,
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
