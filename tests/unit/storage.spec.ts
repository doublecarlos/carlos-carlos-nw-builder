// The versioned envelope (build-parameters plan 0005): every build/collection payload this
// module reads or writes -- localStorage, JSON export/import, share links -- carries a schema
// version, a `kind`, and a catalogue version. These prove the three behaviours that matter:
// un-enveloped (pre-existing) data still works, a genuine mismatch is refused with a message
// instead of silently misread, and a stale catalogue is a soft signal, not a refusal.
import { describe, expect, it, beforeEach } from 'vitest';
import { installWindowShim } from './stores/window-shim';
import * as storage from '../../src/storage';
import { NW_CATALOG_VERSION } from '../../src/data';
import { notice } from '../../src/stores/notice';

beforeEach(() => {
  installWindowShim();
});

describe('localStorage channels: envelope round trip and legacy passthrough', () => {
  it('saveLibrary -> loadLibrary round-trips transparently', () => {
    const build = storage.defaultBuild('Round trip');
    storage.saveLibrary({ builds: [build], activeId: build.id });
    const loaded = storage.loadLibrary();
    expect(loaded.activeId).toBe(build.id);
    expect(loaded.builds).toHaveLength(1);
    expect(loaded.builds[0].name).toBe('Round trip');
  });

  it('reads a legacy (un-enveloped) nw:builds value exactly as before', () => {
    const build = storage.defaultBuild('Legacy');
    window.localStorage.setItem('nw:builds', JSON.stringify({ builds: [build], activeId: build.id }));
    const loaded = storage.loadLibrary();
    expect(loaded.activeId).toBe(build.id);
    expect(loaded.builds[0].name).toBe('Legacy');
  });

  it('a version/kind mismatch falls back to a fresh library and shows a notice, not a crash', () => {
    window.localStorage.setItem('nw:builds', JSON.stringify({
      v: 999, kind: 'library', catalog: NW_CATALOG_VERSION, data: { builds: [], activeId: '' },
    }));
    const loaded = storage.loadLibrary();
    expect(loaded.builds).toHaveLength(1); // emptyLibrary()'s single default build
    expect(notice.value).toMatch(/newer version/i);
  });

  it('overlay: saveOverlay -> loadOverlay round-trips, and a legacy overlay still loads', () => {
    const overlay = { items: { 'some-id': { id: 'some-id', name: 'Test', filter: 'gear_head' } }, bonusSets: {} };
    storage.saveOverlay(overlay as any);
    expect(storage.loadOverlay()).toEqual(overlay);

    window.localStorage.setItem('nw:catalog-overlay', JSON.stringify({ items: {}, bonusSets: { x: null } }));
    expect(storage.loadOverlay()).toEqual({ items: {}, bonusSets: { x: null } });
  });
});

describe('parseJson (single-build import)', () => {
  it('round-trips a build exported via toBuildJson', () => {
    const build = storage.defaultBuild('Exported');
    const { builds, catalogStale } = storage.parseJson(storage.toBuildJson(build));
    expect(builds).toHaveLength(1);
    expect(builds[0].name).toBe('Exported');
    expect(catalogStale).toBe(false);
  });

  it('still accepts an un-enveloped single build or array (backward compatibility)', () => {
    const build = storage.defaultBuild('Plain');
    expect(storage.parseJson(JSON.stringify(build)).builds).toHaveLength(1);
    expect(storage.parseJson(JSON.stringify([build, build])).builds).toHaveLength(2);
  });

  it('refuses a payload from a newer schema version', () => {
    const build = storage.defaultBuild();
    const payload = JSON.stringify({ v: 999, kind: 'build', catalog: NW_CATALOG_VERSION, data: build });
    expect(() => storage.parseJson(payload)).toThrow(/newer version/i);
  });

  it('refuses a payload from an older schema version', () => {
    const build = storage.defaultBuild();
    const payload = JSON.stringify({ v: 0, kind: 'build', catalog: NW_CATALOG_VERSION, data: build });
    expect(() => storage.parseJson(payload)).toThrow(/older version/i);
  });

  it('refuses a collection bundle imported as a single build (wrong kind)', () => {
    const build = storage.defaultBuild();
    const bundle = storage.bundleCollection(
      { id: 'c1', name: 'Coll', updated: 0, buildIds: [build.id], activeBuildId: build.id },
      { [build.id]: build },
    );
    expect(() => storage.parseJson(storage.toCollectionJson(bundle))).toThrow(/not a "build"/);
  });

  it('reports catalogStale when the envelope carries a different catalogue version', () => {
    const build = storage.defaultBuild();
    const payload = JSON.stringify({
      v: storage.SCHEMA_VERSION, kind: 'build', catalog: NW_CATALOG_VERSION + 1, data: build,
    });
    expect(storage.parseJson(payload).catalogStale).toBe(true);
  });
});

describe('parseCollectionJson', () => {
  it('round-trips a bundle exported via toCollectionJson', () => {
    const build = storage.defaultBuild('In a collection');
    const bundle = storage.bundleCollection(
      { id: 'c1', name: 'My collection', updated: 0, buildIds: [build.id], activeBuildId: build.id },
      { [build.id]: build },
    );
    const { collection, builds, catalogStale } = storage.parseCollectionJson(storage.toCollectionJson(bundle));
    expect(collection.name).toBe('My collection');
    expect(builds).toHaveLength(1);
    expect(catalogStale).toBe(false);
  });

  it('refuses a single build imported as a collection (wrong kind)', () => {
    const build = storage.defaultBuild();
    expect(() => storage.parseCollectionJson(storage.toBuildJson(build))).toThrow(/not a "collection"/);
  });
});

describe('share links (encodeShare/decodeShare)', () => {
  it('round-trips a build', async () => {
    const build = storage.defaultBuild('Shared');
    const payload = await storage.encodeShare(build);
    const decoded = await storage.decodeShare(payload);
    expect(decoded?.build.name).toBe('Shared');
    expect(decoded?.catalogStale).toBe(false);
  });

  it('null payload decodes to null', async () => {
    expect(await storage.decodeShare('')).toBeNull();
  });
});
