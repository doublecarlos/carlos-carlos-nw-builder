// Undo coalescing was previously untestable in isolation -- it lived inside App.vue, entangled
// with routing/persistence/every other concern. Now that it's its own module, these prove the
// coalescing behaviour directly: same key within the window collapses to one undo step: a
// different key, or the window elapsing, doesn't.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { installWindowShim } from './window-shim';

async function freshStores() {
  vi.resetModules();
  installWindowShim();
  const library = await import('../../../src/stores/library');
  const buildEditor = await import('../../../src/stores/buildEditor');
  return { library, buildEditor };
}

describe('buildEditor undo coalescing', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('collapses consecutive edits of the same slot into one undo step', async () => {
    const { library, buildEditor } = await freshStores();
    buildEditor.setChoice('ring1', 'ItemA');
    buildEditor.setChoice('ring1', 'ItemB');

    expect(library.build.value.choices.ring1).toBe('ItemB');
    buildEditor.undo();
    expect(library.build.value.choices.ring1).toBeUndefined();
    expect(buildEditor.canUndo.value).toBe(false);
  });

  it('does not coalesce edits to a different slot', async () => {
    const { library, buildEditor } = await freshStores();
    buildEditor.setChoice('ring1', 'ItemA');
    buildEditor.setChoice('ring2', 'ItemC');

    buildEditor.undo();
    expect(library.build.value.choices.ring2).toBeUndefined();
    expect(library.build.value.choices.ring1).toBe('ItemA');

    buildEditor.undo();
    expect(library.build.value.choices.ring1).toBeUndefined();
    expect(buildEditor.canUndo.value).toBe(false);
  });

  it('does not coalesce once the coalescing window has elapsed', async () => {
    vi.useFakeTimers();
    const { library, buildEditor } = await freshStores();
    buildEditor.setChoice('ring1', 'ItemA');
    vi.advanceTimersByTime(800);
    buildEditor.setChoice('ring1', 'ItemB');

    buildEditor.undo();
    expect(library.build.value.choices.ring1).toBe('ItemA');
    expect(buildEditor.canUndo.value).toBe(true);

    buildEditor.undo();
    expect(library.build.value.choices.ring1).toBeUndefined();
  });

  it('redo replays an undone step', async () => {
    const { library, buildEditor } = await freshStores();
    buildEditor.setChoice('ring1', 'ItemA');
    buildEditor.undo();
    expect(library.build.value.choices.ring1).toBeUndefined();

    expect(buildEditor.canRedo.value).toBe(true);
    buildEditor.redo();
    expect(library.build.value.choices.ring1).toBe('ItemA');
    expect(buildEditor.canRedo.value).toBe(false);
  });

  // A build_parameter slot's `path` is resolved against `build.context`, not `build` --
  // setParam/revertSlot writing to the wrong root would either throw (no such top-level
  // property) or silently create a stray field alongside `context` instead of inside it.
  it('setParam writes into build.context at the slot\'s path, not the build root', async () => {
    const { library, buildEditor } = await freshStores();
    const classSlot = { id: 'options.class', label: 'Class', section: 'options',
      type: 'build_parameter' as const, paramType: 'list' as const, path: 'class' };

    buildEditor.setParam(classSlot, 'wizard');

    expect(library.build.value.context.class).toBe('wizard');
    expect((library.build.value as any).class).toBeUndefined();
  });

  it('revertSlot restores a build_parameter to the saved build\'s value', async () => {
    const { library, buildEditor } = await freshStores();
    const classSlot = { id: 'options.class', label: 'Class', section: 'options',
      type: 'build_parameter' as const, paramType: 'list' as const, path: 'class' };
    const savedClass = library.savedById.value[library.activeId.value].context.class;

    buildEditor.setParam(classSlot, 'wizard');
    expect(library.build.value.context.class).toBe('wizard');

    buildEditor.revertSlot('options.class');
    expect(library.build.value.context.class).toBe(savedClass);
  });
});
