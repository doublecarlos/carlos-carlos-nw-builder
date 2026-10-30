// The layer editor's layout rules: side by side on wide screens, master-detail on a phone.
import { describe, expect, it } from "vitest";
import { layerEditorLayout } from "../../src/lib/layer-editor-layout";

describe("layerEditorLayout", () => {
  it.each(["desktop", "tablet"] as const)(
    "shows list and form together on %s, whatever the view",
    (kind) => {
      for (const view of ["list", "detail"] as const) {
        expect(layerEditorLayout(kind, view)).toEqual({
          list: true,
          form: true,
          back: false,
          entriesRail: true,
          actions: "bar",
        });
      }
    },
  );

  it("shows only the list on a phone's list view", () => {
    const layout = layerEditorLayout("phone", "list");
    expect(layout.list).toBe(true);
    expect(layout.form).toBe(false);
  });

  it("shows only the form, with Back, on a phone's detail view", () => {
    const layout = layerEditorLayout("phone", "detail");
    expect(layout.list).toBe(false);
    expect(layout.form).toBe(true);
    expect(layout.back).toBe(true);
  });

  it("drops the entries rail and folds the actions into a menu on a phone", () => {
    for (const view of ["list", "detail"] as const) {
      const layout = layerEditorLayout("phone", view);
      expect(layout.entriesRail).toBe(false);
      expect(layout.actions).toBe("menu");
    }
  });
});
