/**
 * Offline support.
 *
 * The app makes no runtime API calls -- game data is bundled at build time and saves live in
 * IndexedDB -- so "usable offline" reduces to "the browser can find the static build without a
 * network round-trip". That needs no server and no framework: this worker caches the build as
 * it goes past, and serves it back when the network is gone.
 *
 * Two strategies, split on what content-hashed filenames guarantee:
 *
 *   - The entry page is network-first. Its URL never changes (routing lives in the query
 *     string), so a cached copy would pin the user to whichever deploy they first visited.
 *     Going to the network first picks up a new deploy the moment they are online again, with
 *     the cached copy serving only as the offline fallback.
 *   - Everything else is cache-first. Vite gives each build asset a content hash, so a URL
 *     that resolves once resolves to those same bytes forever, and a new deploy asks for new
 *     URLs instead. The unhashed extras (icons, the tesseract core and language model) are
 *     immutable in practice, and caching them is what makes tooltip import work offline too.
 *
 * Bump CACHE to force every client to start from an empty cache -- needed only when the rules
 * above change, not per deploy.
 */

const CACHE = "nwb-offline-v1";

/** This file is served from the deploy root, so the app's entry page is its own directory. */
const INDEX = new URL("./", self.location.href).href;

/**
 * Static hosts routinely answer with `Vary: Origin` (or `Vary: Accept-Encoding`), and the app's
 * entry script and stylesheet are `crossorigin`, so the page sends an `Origin` header where the
 * worker's own priming fetch does not. Honouring Vary would make those two requests different
 * cache keys and miss every time. Only one response per URL is ever stored, so there is nothing
 * for Vary to disambiguate.
 */
const MATCH = { ignoreVary: true };

/** Where Vite writes content-hashed output. Nothing else the app fetches is versioned by
 *  filename, which is what makes this prefix -- and only this prefix -- safe to clear
 *  wholesale when a deploy lands. */
const HASHED_PREFIX = new URL("assets/", INDEX).pathname;

/**
 * The built index.html lists the app shell in its own `src`/`href` attributes, so it doubles as
 * the precache manifest and no build step has to keep a generated list in sync with it.
 */
const shellUrls = (html) =>
  [...html.matchAll(/(?:src|href)="([^"]+)"/g)]
    .map(([, value]) => new URL(value, INDEX))
    .filter((url) => url.origin === self.location.origin)
    .map((url) => url.href);

/**
 * Public files the entry page does not itself reference, so parsing it cannot find them. Only
 * the landing screen's logo qualifies today; it is primed explicitly because it is the first
 * thing a user sees, and without this it would reach the cache only on a second visit.
 */
const EXTRA = ["icon-512.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(install());
});

async function install() {
  try {
    const cache = await caches.open(CACHE);
    const response = await fetch(INDEX);
    if (response.ok) {
      const html = await response.clone().text();
      await cache.put(INDEX, response);
      await cache.addAll([
        ...shellUrls(html),
        ...EXTRA.map((file) => new URL(file, INDEX).href),
      ]);
    }
  } catch {
    // Priming only matters for the very first visit: a worker sees requests made after it
    // takes control, and by then the page and its entry chunks have already been fetched. If
    // it fails -- offline, or a deploy landing mid-install -- the fetch handler still fills
    // the cache on the next load, so installation must not fail along with it.
  }
  await self.skipWaiting();
}

self.addEventListener("activate", (event) => {
  event.waitUntil(activate());
});

async function activate() {
  for (const name of await caches.keys()) {
    if (name !== CACHE) await caches.delete(name);
  }
  // Claim the page that installed us, so its first offline reload already has a cache to read.
  await self.clients.claim();
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  // Everything the app loads is a same-origin GET; anything else (a cross-origin image pasted
  // into a build, say) is left to the browser rather than guessed at.
  if (request.method !== "GET") return;
  if (new URL(request.url).origin !== self.location.origin) return;

  event.respondWith(
    request.mode === "navigate" ? networkFirst(request) : cacheFirst(request),
  );
});

async function cacheFirst(request) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(request, MATCH);
  if (cached) return cached;

  const response = await fetch(request);
  if (response.ok) await cache.put(request, response.clone());
  return response;
}

/** Navigations all resolve to the same page, so they are cached under one key -- otherwise
 *  every distinct `?build=...` link would store its own copy of identical HTML. */
async function networkFirst(request) {
  const cache = await caches.open(CACHE);
  try {
    const response = await fetch(request);
    if (response.ok) await storeIndex(cache, response.clone());
    return response;
  } catch (error) {
    const cached = await cache.match(INDEX, MATCH);
    if (cached) return cached;
    throw error;
  }
}

/**
 * Awaited before the navigation response is handed back, deliberately: the page starts
 * requesting the new build's assets as soon as it has the HTML, and pruning after that point
 * could delete an asset the fetch handler had just cached.
 */
async function storeIndex(cache, response) {
  const previous = await cache.match(INDEX, MATCH);
  const html = await response.clone().text();
  if (!previous || (await previous.text()) !== html) {
    // A changed entry page means a new deploy: its hashed assets are dead URLs nothing will
    // ask for again, so drop them rather than let every deploy leave a layer behind.
    for (const cached of await cache.keys()) {
      if (new URL(cached.url).pathname.startsWith(HASHED_PREFIX)) {
        await cache.delete(cached, MATCH);
      }
    }
  }
  await cache.put(INDEX, response);
}
