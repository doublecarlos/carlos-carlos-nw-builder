// The echo guard: a source equal to what the form last emitted must not rebuild the draft,
// even when its keys arrive in a different order.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { computed, effectScope, nextTick, ref } from "vue";
import { useEditorDraft } from "../../../src/composables/useEditorDraft";

interface Entity {
  a: number;
  b: number;
}

function setup(initial: Entity) {
  const source = ref<Entity>(initial);
  const buildDraft = vi.fn((value: Entity | null | undefined) => ({
    a: value?.a ?? 0,
    b: value?.b ?? 0,
  }));
  const scope = effectScope();
  scope.run(() =>
    useEditorDraft<Entity, Entity, Entity>({
      source: () => source.value,
      isNew: computed(() => false),
      buildDraft,
      // Emits keys in the opposite order from the source.
      toEntity: (draft) => ({ b: draft.b, a: draft.a }),
      diffLabel: () => "edit",
      hasContent: () => true,
      emit: () => {},
      displayId: { sourceId: () => "id", computeId: () => "id" },
    }),
  );
  return { source, buildDraft, scope };
}

describe("useEditorDraft source echo", () => {
  beforeEach(() => vi.stubGlobal("window", globalThis));
  afterEach(() => vi.unstubAllGlobals());

  it("skips the rebuild for an equal source in a different key order", async () => {
    const { source, buildDraft, scope } = setup({ a: 1, b: 2 });
    buildDraft.mockClear();
    source.value = { a: 1, b: 2 };
    await nextTick();
    expect(buildDraft).not.toHaveBeenCalled();
    scope.stop();
  });

  it("rebuilds for a source with different values", async () => {
    const { source, buildDraft, scope } = setup({ a: 1, b: 2 });
    buildDraft.mockClear();
    source.value = { a: 1, b: 3 };
    await nextTick();
    expect(buildDraft).toHaveBeenCalledOnce();
    scope.stop();
  });
});
