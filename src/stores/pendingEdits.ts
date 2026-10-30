// Debounced live edits that open forms have not written out yet. Anything about to change what
// those edits would land in (a selection switch, an undo, the page going away) flushes them
// first, so each edit commits into the entry and layer it was typed into.
type Flush = () => void;

const _flushes = new Set<Flush>();

/** Registers a form's flush. Returns an unregister function. */
export function register(flush: Flush): () => void {
  _flushes.add(flush);
  return () => {
    _flushes.delete(flush);
  };
}

/** Runs every registered flush, in registration order. */
export function flushAll() {
  for (const flush of [..._flushes]) flush();
}
