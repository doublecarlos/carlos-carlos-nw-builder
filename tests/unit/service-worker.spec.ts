// public/sw.js is a classic worker script: it can't be imported, and the caching rules it
// encodes -- what survives a deploy, what is served with no network at all -- are exactly the
// kind of thing that fails silently in production. So it is evaluated here against a fake
// `self`, `caches` and `fetch`, and driven through the events a browser would send it.
import { describe, it, expect, beforeEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const SW_URL = "https://app.test/sw.js";
const ORIGIN = "https://app.test";
const INDEX = `${ORIGIN}/`;
const CACHE = "nwb-offline-v1";

const source = readFileSync(
  path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
    "..",
    "public",
    "sw.js",
  ),
  "utf8",
);

/** The shape sw.js actually touches on a request: a URL, a method and a mode. */
type FakeRequest = { url: string; method: string; mode: string };

const urlOf = (request: string | FakeRequest) =>
  typeof request === "string" ? request : request.url;

const indexHtml = (hash: string) => `<!doctype html>
<html lang="en">
  <head>
    <link rel="canonical" href="${ORIGIN}/" />
    <link rel="icon" href="/favicon.ico" sizes="32x32" />
    <link rel="manifest" href="/manifest.webmanifest" />
    <script type="module" crossorigin src="/assets/index-${hash}.js"></script>
    <link rel="stylesheet" crossorigin href="/assets/index-${hash}.css">
  </head>
  <body><div id="app">Loading</div></body>
</html>`;

type MatchOptions = { ignoreVary?: boolean } | undefined;

/**
 * Vary is modelled because it is the one Cache API subtlety that actually bit here: hosts
 * answer static assets with `Vary: Origin`, and the entry script is `crossorigin`, so the
 * page's request carries an `Origin` header that the worker's priming fetch does not. Without
 * `ignoreVary` every asset lookup misses. Any stored response carrying Vary is therefore
 * treated as a mismatched key unless the caller opted out.
 */
class FakeCache {
  readonly entries = new Map<string, Response>();

  constructor(private readonly net: (url: string) => Promise<Response>) {}

  async put(request: string | FakeRequest, response: Response) {
    this.entries.set(urlOf(request), response);
  }

  async match(request: string | FakeRequest, options?: MatchOptions) {
    const stored = this.entries.get(urlOf(request));
    if (stored?.headers.has("vary") && !options?.ignoreVary) return undefined;
    return stored;
  }

  async keys(): Promise<FakeRequest[]> {
    return [...this.entries.keys()].map((url) => ({
      url,
      method: "GET",
      mode: "cors",
    }));
  }

  async delete(request: string | FakeRequest, options?: MatchOptions) {
    if (!(await this.match(request, options))) return false;
    return this.entries.delete(urlOf(request));
  }

  async addAll(urls: string[]) {
    // Matches the real contract: one failure rejects the whole call and stores nothing.
    const responses = await Promise.all(urls.map((url) => this.net(url)));
    urls.forEach((url, i) => this.entries.set(url, responses[i]!));
  }
}

function createWorker() {
  const files = new Map<string, string>([
    [INDEX, indexHtml("v1")],
    [`${ORIGIN}/assets/index-v1.js`, "// entry v1"],
    [`${ORIGIN}/assets/index-v1.css`, ":root{}"],
    [`${ORIGIN}/assets/index-v2.js`, "// entry v2"],
    [`${ORIGIN}/assets/index-v2.css`, ":root{--v2:1}"],
    [`${ORIGIN}/favicon.ico`, "icon-bytes"],
    [`${ORIGIN}/manifest.webmanifest`, "{}"],
    [`${ORIGIN}/icon-512.png`, "logo-bytes"],
    [`${ORIGIN}/tesseract/worker.min.js`, "// ocr worker"],
  ]);

  let online = true;
  const fetched: string[] = [];
  const net = async (target: string | FakeRequest) => {
    const url = urlOf(target);
    fetched.push(url);
    if (!online) throw new TypeError("Failed to fetch");
    const body = files.get(url);
    if (body == null) return new Response("not found", { status: 404 });
    // As a static host answers: see FakeCache above for why Vary matters.
    return new Response(body, { status: 200, headers: { Vary: "Origin" } });
  };

  const stores = new Map<string, FakeCache>();
  const caches = {
    open: async (name: string) => {
      const store = stores.get(name) ?? new FakeCache((url) => net(url));
      stores.set(name, store);
      return store;
    },
    keys: async () => [...stores.keys()],
    delete: async (name: string) => stores.delete(name),
  };

  const listeners = new Map<string, (event: unknown) => void>();
  const self = {
    location: new URL(SW_URL),
    addEventListener: (type: string, handler: (event: unknown) => void) =>
      listeners.set(type, handler),
    skipWaiting: vi.fn(async () => {}),
    clients: { claim: vi.fn(async () => {}) },
  };

  new Function("self", "caches", "fetch", source)(self, caches, net);

  const lifecycle = async (type: "install" | "activate") => {
    const pending: Promise<unknown>[] = [];
    listeners.get(type)!({
      waitUntil: (p: Promise<unknown>) => pending.push(p),
    });
    await Promise.all(pending);
  };

  const request = async (url: string, init: Partial<FakeRequest> = {}) => {
    let responded: Promise<Response> | undefined;
    listeners.get("fetch")!({
      request: { url, method: "GET", mode: "cors", ...init },
      respondWith: (p: Promise<Response>) => {
        responded = p;
      },
    });
    return responded;
  };

  return {
    self,
    fetched,
    stores,
    install: () => lifecycle("install"),
    activate: () => lifecycle("activate"),
    request,
    navigate: (url = INDEX) => request(url, { mode: "navigate" }),
    goOffline: () => {
      online = false;
    },
    deploy: (hash: string) => files.set(INDEX, indexHtml(hash)),
    cached: () => [...(stores.get(CACHE)?.entries.keys() ?? [])],
  };
}

let worker: ReturnType<typeof createWorker>;

beforeEach(() => {
  worker = createWorker();
});

describe("install", () => {
  it("primes the cache from the entry page's own asset list", async () => {
    await worker.install();

    expect(worker.cached()).toEqual(
      expect.arrayContaining([
        INDEX,
        `${ORIGIN}/favicon.ico`,
        `${ORIGIN}/assets/index-v1.js`,
        `${ORIGIN}/assets/index-v1.css`,
      ]),
    );
  });

  it("does not follow the entry page's canonical link back to itself", async () => {
    await worker.install();

    // The canonical link is a same-origin `href` like any other, so the manifest parser sees
    // it; priming has already cached the page under that URL by then.
    expect(worker.fetched.filter((url) => url === INDEX)).toHaveLength(1);
  });

  it("primes the manifest, so an installed copy still starts offline", async () => {
    await worker.install();

    expect(worker.cached()).toContain(`${ORIGIN}/manifest.webmanifest`);
  });

  it("primes the landing logo, which the entry page never mentions", async () => {
    await worker.install();

    expect(worker.cached()).toContain(`${ORIGIN}/icon-512.png`);
  });

  it("installs anyway when the very first visit ends offline", async () => {
    worker.goOffline();

    await expect(worker.install()).resolves.toBeUndefined();
    expect(worker.self.skipWaiting).toHaveBeenCalled();
  });
});

describe("activate", () => {
  it("drops caches left by an earlier worker and claims open pages", async () => {
    await worker.install();
    worker.stores.set(
      "nwb-offline-v0",
      new FakeCache(async () => new Response("")),
    );

    await worker.activate();

    expect([...worker.stores.keys()]).toEqual([CACHE]);
    expect(worker.self.clients.claim).toHaveBeenCalled();
  });
});

describe("fetch", () => {
  it("leaves non-GET and cross-origin requests to the browser", async () => {
    expect(await worker.request(INDEX, { method: "POST" })).toBeUndefined();
    expect(await worker.request("https://cdn.other/x.png")).toBeUndefined();
  });

  it("serves a hashed asset from cache without touching the network", async () => {
    await worker.install();
    const before = worker.fetched.length;

    const response = await worker.request(`${ORIGIN}/assets/index-v1.js`);

    expect(await response!.text()).toBe("// entry v1");
    expect(worker.fetched.length).toBe(before);
  });

  it("caches an asset it had to fetch, so the next ask is offline-safe", async () => {
    await worker.install();
    await worker.request(`${ORIGIN}/tesseract/worker.min.js`);
    worker.goOffline();

    const response = await worker.request(`${ORIGIN}/tesseract/worker.min.js`);

    expect(await response!.text()).toBe("// ocr worker");
  });

  it("does not cache a response the server refused", async () => {
    await worker.install();

    const response = await worker.request(`${ORIGIN}/assets/missing.js`);

    expect(response!.status).toBe(404);
    expect(worker.cached()).not.toContain(`${ORIGIN}/assets/missing.js`);
  });

  it("prefers the network for the page, so a new deploy is picked up", async () => {
    await worker.install();
    worker.deploy("v2");

    const response = await worker.navigate();

    expect(await response!.text()).toContain("index-v2.js");
  });

  it("falls back to the cached page when the network is gone", async () => {
    await worker.install();
    worker.goOffline();

    const response = await worker.navigate();

    expect(await response!.text()).toContain("index-v1.js");
  });

  it("answers a deep link offline from the same cached page", async () => {
    await worker.install();
    worker.goOffline();

    const response = await worker.navigate(`${INDEX}?build=abc`);

    expect(await response!.text()).toContain("index-v1.js");
  });

  it("gives up rather than inventing a page it never cached", async () => {
    worker.goOffline();

    await expect(worker.navigate()).rejects.toThrow();
  });

  it("clears the old build's hashed assets on deploy, keeping unhashed ones", async () => {
    await worker.install();
    await worker.request(`${ORIGIN}/tesseract/worker.min.js`);
    worker.deploy("v2");

    await worker.navigate();

    expect(worker.cached()).not.toContain(`${ORIGIN}/assets/index-v1.js`);
    expect(worker.cached()).not.toContain(`${ORIGIN}/assets/index-v1.css`);
    expect(worker.cached()).toContain(`${ORIGIN}/tesseract/worker.min.js`);
    expect(worker.cached()).toContain(`${ORIGIN}/favicon.ico`);
  });

  it("keeps hashed assets in place when the page has not changed", async () => {
    await worker.install();

    await worker.navigate();

    expect(worker.cached()).toContain(`${ORIGIN}/assets/index-v1.js`);
  });
});
