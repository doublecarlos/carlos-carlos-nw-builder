// File System Access API + a one-table IndexedDB, so a collection "linked" to a file on disk
// (build-nav.js's collection menu -> Save As -> File on this PC) can keep saving to that same
// file across a reload, not just for the rest of this tab's session.
//
// Chromium-only (Edge/Chrome) as of writing -- `supported` gates every caller, and the
// fallback (a plain download, no persistent link) lives in app.js next to the existing
// Blob/anchor `downloadExport` technique, not here.

window.NW = window.NW ?? {};
window.NW.fsStore = (() => {
  'use strict';

  const DB_NAME = 'nw-fs-handles';
  const STORE = 'handles';

  const supported = typeof window.showSaveFilePicker === 'function';

  function openDb() {
    return new Promise((resolve, reject) => {
      const request = window.indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = () => request.result.createObjectStore(STORE);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async function withStore(mode, fn) {
    const db = await openDb();
    try {
      return await new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, mode);
        const store = tx.objectStore(STORE);
        const request = fn(store);
        tx.oncomplete = () => resolve(request.result);
        tx.onerror = () => reject(tx.error);
      });
    } finally {
      db.close();
    }
  }

  const getHandle = (collectionId) => withStore('readonly', (store) => store.get(collectionId))
    .catch(() => null);

  const setHandle = (collectionId, handle) => withStore('readwrite', (store) => store.put(handle, collectionId))
    .then(() => true).catch(() => false);

  const deleteHandle = (collectionId) => withStore('readwrite', (store) => store.delete(collectionId))
    .then(() => true).catch(() => false);

  function pickSaveFile(suggestedName) {
    return window.showSaveFilePicker({
      suggestedName,
      types: [{ description: 'Neverwinter build collection', accept: { 'application/json': ['.json'] } }],
    });
  }

  /** Chromium re-checks file permission per session -- `queryPermission` alone is often
   * 'prompt' again after a reload, and `requestPermission` needs to run from a user gesture,
   * which every caller here already is (a click on Save/Save As). */
  async function verifyPermission(handle) {
    const opts = { mode: 'readwrite' };
    if ((await handle.queryPermission(opts)) === 'granted') return true;
    return (await handle.requestPermission(opts)) === 'granted';
  }

  async function writeText(handle, text) {
    const writable = await handle.createWritable();
    await writable.write(text);
    await writable.close();
  }

  return { supported, getHandle, setHandle, deleteHandle, pickSaveFile, verifyPermission, writeText };
})();
