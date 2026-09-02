// Both halves of "Save to repo": the endpoint that writes the file, and the browser client
// that decides where to send it and how to describe what came back.
//
// The endpoint runs against a real `node:http` server rather than fake req/res objects --
// CORS, preflights and content-type refusals are things a browser does to a socket, and a
// double would only assert this file's idea of them. It writes into a temp directory, so the
// suite never touches the repo's own `data/`.
import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { createServer, type Server } from "node:http";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  handleWriteback,
  WRITEBACK_PATH as SERVER_PATH,
} from "../../scripts/writeback";
import {
  writebackUrl,
  writeDataFile,
  WritebackError,
} from "../../src/data/writeback";

const DEPLOYED_ORIGIN = "https://carloscarlosnwbuilder.pages.dev";

describe("the writeback endpoint", () => {
  let server: Server;
  let base: string;
  let repo: string;
  let dataDir: string;

  beforeEach(async () => {
    repo = await mkdtemp(path.join(tmpdir(), "writeback-"));
    dataDir = path.join(repo, "data");
    await mkdir(dataDir);
    server = createServer((req, res) => {
      void handleWriteback(req, res, dataDir);
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const address = server.address();
    if (address === null || typeof address === "string") {
      throw new Error("expected a TCP address");
    }
    base = `http://127.0.0.1:${address.port}${SERVER_PATH}`;
  });

  afterEach(async () => {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  });

  const post = (body: unknown, init: RequestInit = {}) =>
    fetch(base, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      ...init,
    });

  it("writes an allowlisted file and names the repo it landed in", async () => {
    const response = await post({
      file: "db-items.json",
      body: '[{"id":"x"}]\n',
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ ok: true, repo });
    await expect(
      readFile(path.join(dataDir, "db-items.json"), "utf8"),
    ).resolves.toBe('[{"id":"x"}]\n');
  });

  it("writes each of the three data files", async () => {
    const statuses: Record<string, number> = {};
    for (const file of ["db-items.json", "db-bonuses.json", "slots.json"]) {
      statuses[file] = (await post({ file, body: "[]\n" })).status;
    }

    expect(statuses).toEqual({
      "db-items.json": 200,
      "db-bonuses.json": 200,
      "slots.json": 200,
    });
  });

  it("refuses a filename outside the allowlist without creating it", async () => {
    const response = await post({ file: "catalog.ts", body: "danger" });

    expect(response.status).toBe(400);
    await expect(
      readFile(path.join(dataDir, "catalog.ts"), "utf8"),
    ).rejects.toThrow();
  });

  it("refuses a path that climbs out of the data directory", async () => {
    const response = await post({
      file: "../package.json",
      body: "danger",
    });

    expect(response.status).toBe(400);
  });

  it("refuses a cross-site origin, leaving the file alone", async () => {
    await writeFile(path.join(dataDir, "slots.json"), "original", "utf8");

    const response = await post(
      { file: "slots.json", body: "replaced" },
      {
        headers: {
          "content-type": "application/json",
          origin: "https://evil.example",
        },
      },
    );

    expect(response.status).toBe(403);
    await expect(
      readFile(path.join(dataDir, "slots.json"), "utf8"),
    ).resolves.toBe("original");
  });

  it("accepts the deployed site and lets it read the answer", async () => {
    const response = await post(
      { file: "slots.json", body: "{}\n" },
      {
        headers: {
          "content-type": "application/json",
          origin: DEPLOYED_ORIGIN,
        },
      },
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("access-control-allow-origin")).toBe(
      DEPLOYED_ORIGIN,
    );
  });

  it("answers the private-network preflight Chrome sends from a public page", async () => {
    const response = await fetch(base, {
      method: "OPTIONS",
      headers: {
        origin: DEPLOYED_ORIGIN,
        "access-control-request-method": "POST",
        "access-control-request-private-network": "true",
      },
    });

    expect(response.status).toBe(204);
    expect(response.headers.get("access-control-allow-private-network")).toBe(
      "true",
    );
  });

  // Without this the request would be a CORS *simple* request: sent, and the file overwritten,
  // before any refusal could reach it.
  it("refuses a body that skipped the preflight-forcing content type", async () => {
    const response = await post(
      { file: "slots.json", body: "{}\n" },
      { headers: { "content-type": "text/plain" } },
    );

    expect(response.status).toBe(415);
  });

  it("refuses a method that is not POST", async () => {
    const response = await fetch(base);

    expect(response.status).toBe(405);
  });

  it("refuses a body that is not the expected shape", async () => {
    const response = await post({ file: "slots.json" });

    expect(response.status).toBe(400);
  });
});

describe("choosing where to send the write", () => {
  it("stays same-origin when the page is served locally, whatever the port", () => {
    expect(writebackUrl("localhost")).toBe(SERVER_PATH);
    expect(writebackUrl("127.0.0.1")).toBe(SERVER_PATH);
  });

  it("names the fixed local port when the page came from the deployed site", () => {
    expect(writebackUrl("carloscarlosnwbuilder.pages.dev")).toBe(
      `http://localhost:5173${SERVER_PATH}`,
    );
  });
});

describe("reporting what came back", () => {
  const stubLocation = (hostname: string) => {
    vi.stubGlobal("location", { hostname });
  };

  beforeEach(() => {
    stubLocation("localhost");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const stubFetch = (impl: () => Promise<Response>) =>
    vi.stubGlobal("fetch", vi.fn(impl));

  it("passes the file and body through to the endpoint", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      Response.json({ ok: true, repo: "/repo" }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await writeDataFile("db-items.json", "[]\n");

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(SERVER_PATH);
    expect(JSON.parse(init?.body as string)).toEqual({
      file: "db-items.json",
      body: "[]\n",
    });
  });

  it("reports the repo the endpoint wrote into", async () => {
    stubFetch(async () => Response.json({ ok: true, repo: "E:\\worktree" }));

    await expect(writeDataFile("slots.json", "{}\n")).resolves.toEqual({
      repo: "E:\\worktree",
    });
  });

  it("tells you to start the server when nothing accepted the connection", async () => {
    stubFetch(() => Promise.reject(new TypeError("Failed to fetch")));

    await expect(writeDataFile("slots.json", "{}\n")).rejects.toThrow(
      /npm run data-server/,
    );
  });

  // A 404 page, or an unrelated dev server holding the port: reachable, but not this.
  it("separates a wrong answer from no answer at all", async () => {
    stubFetch(async () => new Response("<!doctype html>", { status: 404 }));

    await expect(writeDataFile("slots.json", "{}\n")).rejects.toThrow(
      /not as a writeback server/,
    );
  });

  it("passes the endpoint's own refusal through as the message", async () => {
    stubFetch(async () =>
      Response.json({ ok: false, error: "catalog.ts is not writable" }),
    );

    await expect(writeDataFile("catalog.ts", "")).rejects.toThrow(
      new WritebackError("catalog.ts is not writable"),
    );
  });

  it("uses the absolute endpoint from the deployed site", async () => {
    stubLocation("carloscarlosnwbuilder.pages.dev");
    const fetchMock = vi.fn<typeof fetch>(async () =>
      Response.json({ ok: true, repo: "/repo" }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await writeDataFile("slots.json", "{}\n");

    expect(fetchMock.mock.calls[0][0]).toBe(
      `http://localhost:5173${SERVER_PATH}`,
    );
  });
});
