// The dirty-check was previously an App.vue computed with no way to exercise it without the
// whole component tree. These prove it directly: an edit makes the active build dirty, saving
// clears it, and `dirtyByBuild` tracks every build in the pool independently.
import { describe, expect, it, vi } from 'vitest';
import { installWindowShim } from './window-shim';

async function freshStores() {
  vi.resetModules();
  installWindowShim();
  const library = await import('../../../src/stores/library');
  const buildEditor = await import('../../../src/stores/buildEditor');
  return { library, buildEditor };
}

describe('library dirty-check', () => {
  it('is clean on a fresh load', async () => {
    const { library } = await freshStores();
    expect(library.dirty.value).toBe(false);
  });

  it('goes dirty on an edit and clean again after saving', async () => {
    const { library, buildEditor } = await freshStores();
    buildEditor.setChoice('ring1', 'ItemA');
    expect(library.dirty.value).toBe(true);

    buildEditor.saveActive();
    expect(library.dirty.value).toBe(false);
  });

  it('reverting an edit restores the saved snapshot and clears dirty', async () => {
    const { library, buildEditor } = await freshStores();
    buildEditor.setChoice('ring1', 'ItemA');
    buildEditor.revertActive();
    expect(library.build.value.choices.ring1).toBeUndefined();
    expect(library.dirty.value).toBe(false);
  });

  it('dirtyByBuild tracks each build independently', async () => {
    const { library, buildEditor } = await freshStores();
    const firstId = library.activeId.value;
    library.createBuild();
    const secondId = library.activeId.value;
    expect(secondId).not.toBe(firstId);

    buildEditor.setChoice('ring1', 'ItemA');
    expect(library.dirtyByBuild.value[secondId]).toBe(true);
    expect(library.dirtyByBuild.value[firstId]).toBe(false);
  });
});
