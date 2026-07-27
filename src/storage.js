// Build persistence, import/export and share links (plan §4.2, Phase 4).
//
// Owns the shape of a stored build so `app.js` never has to reason about it: anything that
// comes back from localStorage, a pasted JSON blob or a URL hash goes through `normalise`
// first, and anything `normalise` returns is safe to hand straight to the engine.
//
// The library lives under `nw:builds`. Phase 3 autosaved a single build under
// `nw:current-build`; that key is migrated in on first load and then removed.

window.NW = window.NW ?? {};
window.NW.storage = (() => {
  'use strict';

  const KEY = 'nw:builds';
  const LEGACY_KEY = 'nw:current-build';
  const OVERLAY_KEY = 'nw:catalog-overlay';
  const HASH_PREFIX = '#b=';

  // Payload markers, so a link made before/after a browser gained CompressionStream still
  // decodes. `d` = raw deflate, `j` = uncompressed JSON.
  const DEFLATED = 'd';
  const PLAIN = 'j';

  /**
   * The sheet's own forte picks. `NW_SCHEMA.context.defaults` carries no `forte` key -- see the
   * open item in llm/plans/0002-ui-handoff.md §9.
   */
  const DEFAULT_FORTE = { primary: 'power_p', secondaryA: 'strike_p', secondaryB: 'awareness_p' };

  const newId = () => `b_${Math.random().toString(36).slice(2, 8)}${Date.now().toString(36).slice(-3)}`;

  function defaultBuild(name = 'New build') {
    const defaults = window.NW_SCHEMA.context.defaults;
    return {
      id: newId(),
      name,
      updated: Date.now(),
      choices: {},
      values: {},
      context: {
        ...defaults,
        toggles: { ...defaults.toggles },
        forte: { ...DEFAULT_FORTE },
      },
    };
  }

  /**
   * Coerce anything build-shaped into a valid build. Tolerates a truncated write, an older
   * shape, a hand-edited export, or a user who pasted nonsense: unknown keys survive, missing
   * ones fall back to defaults, and the wrong type anywhere is replaced rather than thrown on.
   */
  function normalise(raw, { keepId = true } = {}) {
    const base = defaultBuild();
    if (!raw || typeof raw !== 'object') return base;

    const isPlain = (value) => value && typeof value === 'object' && !Array.isArray(value);
    const strings = (source) => {
      const out = {};
      if (!isPlain(source)) return out;
      for (const [key, value] of Object.entries(source)) {
        if (typeof value === 'string' && value !== '' && value !== '-') out[key] = value;
      }
      return out;
    };
    const numbers = (source) => {
      const out = {};
      if (!isPlain(source)) return out;
      for (const [key, value] of Object.entries(source)) {
        const parsed = Number(value);
        if (value !== '' && value != null && Number.isFinite(parsed)) out[key] = parsed;
      }
      return out;
    };

    const context = isPlain(raw.context) ? raw.context : {};

    // Custom gear stored with the build. Nothing writes this yet -- the editor edits the
    // workspace layer -- but preserving it here means a build carrying custom items survives
    // a save/reload/share round trip, so turning the feature on is a UI change and not a
    // migration. `app.js` already folds `build.catalog` in as a catalogue layer.
    const perBuild = isPlain(raw.catalog) ? window.NW.catalog.normaliseOverlay(raw.catalog) : null;

    return {
      ...base,
      ...(perBuild && !window.NW.catalog.isEmpty(perBuild) ? { catalog: perBuild } : {}),
      id: keepId && typeof raw.id === 'string' && raw.id ? raw.id : base.id,
      name: typeof raw.name === 'string' && raw.name.trim() ? raw.name : base.name,
      updated: Number.isFinite(raw.updated) ? raw.updated : Date.now(),
      choices: strings(raw.choices),
      values: numbers(raw.values),
      context: {
        ...base.context,
        ...context,
        duration: Number.isFinite(Number(context.duration))
          ? Math.max(Number(context.duration), 0)
          : base.context.duration,
        magnitude: Number.isFinite(Number(context.magnitude))
          ? Number(context.magnitude)
          : base.context.magnitude,
        toggles: { ...base.context.toggles, ...(isPlain(context.toggles) ? context.toggles : {}) },
        forte: { ...base.context.forte, ...(isPlain(context.forte) ? context.forte : {}) },
      },
    };
  }

  function duplicate(build, name) {
    return { ...normalise(build), id: newId(), name: name ?? `${build.name} copy`,
      updated: Date.now() };
  }

  // --- the library ------------------------------------------------------------------------

  function emptyLibrary() {
    const build = defaultBuild();
    return { builds: [build], activeId: build.id };
  }

  function loadLibrary() {
    let stored = null;
    try {
      stored = JSON.parse(window.localStorage.getItem(KEY) ?? 'null');
    } catch {
      stored = null;
    }

    if (!stored || !Array.isArray(stored.builds) || !stored.builds.length) {
      const migrated = migrateLegacy();
      return migrated ?? emptyLibrary();
    }

    const builds = stored.builds.map((build) => normalise(build));
    const activeId = builds.some((build) => build.id === stored.activeId)
      ? stored.activeId
      : builds[0].id;
    return { builds, activeId };
  }

  /** Phase 3's single-build key. Read once, folded into the library, then dropped. */
  function migrateLegacy() {
    let legacy = null;
    try {
      legacy = JSON.parse(window.localStorage.getItem(LEGACY_KEY) ?? 'null');
    } catch {
      return null;
    }
    if (!legacy || typeof legacy !== 'object') return null;

    const build = normalise(legacy);
    try {
      window.localStorage.removeItem(LEGACY_KEY);
    } catch { /* nothing to do about it */ }
    return { builds: [build], activeId: build.id };
  }

  function saveLibrary(library) {
    try {
      window.localStorage.setItem(KEY, JSON.stringify({
        builds: library.builds,
        activeId: library.activeId,
      }));
      return true;
    } catch {
      // Private browsing, or quota. Losing autosave is not worth an error dialogue -- but the
      // caller is told, so it can surface it once rather than silently.
      return false;
    }
  }

  // --- the catalogue overlay ---------------------------------------------------------------
  // The editor's layer over the shipped items and bonuses. Kept under its own key because it
  // is a workspace, not part of any build: switching builds must not change the catalogue.

  function loadOverlay() {
    try {
      return window.NW.catalog.normaliseOverlay(
        JSON.parse(window.localStorage.getItem(OVERLAY_KEY) ?? 'null'),
      );
    } catch {
      return window.NW.catalog.emptyOverlay();
    }
  }

  function saveOverlay(overlay) {
    try {
      if (window.NW.catalog.isEmpty(overlay)) window.localStorage.removeItem(OVERLAY_KEY);
      else window.localStorage.setItem(OVERLAY_KEY, JSON.stringify(overlay));
      return true;
    } catch {
      return false;
    }
  }

  // --- import / export --------------------------------------------------------------------

  const toJson = (build) => JSON.stringify(build, null, 2);

  /**
   * Accepts a single build or an array of them, and returns an array either way. Throws only
   * on unparseable text -- structural problems are absorbed by `normalise`.
   */
  function parseJson(text) {
    const parsed = JSON.parse(text);
    const list = Array.isArray(parsed) ? parsed : [parsed];
    if (!list.length) throw new Error('no builds in that JSON');
    return list.map((build) => normalise(build, { keepId: false }));
  }

  // --- share links ------------------------------------------------------------------------

  const bytesToBase64Url = (bytes) => {
    // Chunked: String.fromCharCode(...bytes) blows the argument limit on a few kB.
    let binary = '';
    for (let i = 0; i < bytes.length; i += 0x8000) {
      binary += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    }
    return window.btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  };

  const base64UrlToBytes = (text) => {
    const padded = text.replace(/-/g, '+').replace(/_/g, '/')
      .padEnd(Math.ceil(text.length / 4) * 4, '=');
    const binary = window.atob(padded);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return bytes;
  };

  const hasCompression = () => typeof window.CompressionStream === 'function'
    && typeof window.DecompressionStream === 'function';

  /**
   * A build is ~4 kB of repetitive JSON -- slot ids and item names -- so deflate takes it to
   * roughly a tenth of that, which keeps the link inside every practical URL limit.
   */
  async function encodeShare(build) {
    const json = JSON.stringify(normalise(build));
    const bytes = new TextEncoder().encode(json);
    if (!hasCompression()) return PLAIN + bytesToBase64Url(bytes);

    const stream = new Blob([bytes]).stream()
      .pipeThrough(new window.CompressionStream('deflate-raw'));
    const buffer = await new Response(stream).arrayBuffer();
    return DEFLATED + bytesToBase64Url(new Uint8Array(buffer));
  }

  async function decodeShare(payload) {
    if (!payload) return null;
    const marker = payload[0];
    const bytes = base64UrlToBytes(payload.slice(1));

    let json;
    if (marker === DEFLATED) {
      if (!hasCompression()) throw new Error('this browser cannot read compressed links');
      const stream = new Blob([bytes]).stream()
        .pipeThrough(new window.DecompressionStream('deflate-raw'));
      json = await new Response(stream).text();
    } else if (marker === PLAIN) {
      json = new TextDecoder().decode(bytes);
    } else {
      throw new Error('unrecognised share link');
    }

    return normalise(JSON.parse(json), { keepId: false });
  }

  const shareUrl = (payload) => {
    const url = new URL(window.location.href);
    url.hash = '';
    return `${url.href.replace(/#$/, '')}${HASH_PREFIX}${payload}`;
  };

  /** The payload in the current URL, or null. Does not modify the URL. */
  const readHash = () => (window.location.hash.startsWith(HASH_PREFIX)
    ? window.location.hash.slice(HASH_PREFIX.length)
    : null);

  /** Drop the hash without adding a history entry -- the link has been consumed. */
  const clearHash = () => {
    const url = new URL(window.location.href);
    url.hash = '';
    window.history.replaceState(null, '', url.href.replace(/#$/, ''));
  };

  return {
    defaultBuild, normalise, duplicate, newId,
    loadLibrary, saveLibrary, loadOverlay, saveOverlay,
    toJson, parseJson,
    encodeShare, decodeShare, shareUrl, readHash, clearHash,
  };
})();
