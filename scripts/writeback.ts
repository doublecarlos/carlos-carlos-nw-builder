// Writes a composed db-items.json / db-bonuses.json / slots.json into `data/`.
//
// One handler, two hosts: `writebackPlugin()` on the Vite dev server, where the request is
// same-origin and follows whatever port the worktree uses (ports.ts), and `npm run
// data-server` on a fixed 5173 for the deployed site, which is necessarily cross-origin.
//
// Cross-origin requests are held off by two things a page in another tab cannot get around:
// `Origin` is browser-set and unforgeable from script, and requiring `application/json`
// keeps every attempt non-simple, so it needs a preflight only allowlisted origins get. A
// `text/plain` POST would be a CORS simple request -- sent, and the file overwritten, before
// the browser hid the response.
import { writeFile } from "node:fs/promises";
import path from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Connect, Plugin } from "vite";

/** Duplicated in `src/data/writeback.ts`, which cannot import this module without dragging
 *  `node:fs` into the bundle; a unit test keeps the two in step. */
export const WRITEBACK_PATH = "/__data/write";

/** Fixed: the deployed site has to name a port and cannot discover one. `ports.ts` shifts off
 *  5173 only for agent worktrees, which reach the endpoint same-origin. */
export const WRITEBACK_PORT = 5173;

const WRITABLE_FILES = new Set([
  "db-items.json",
  "db-bonuses.json",
  "slots.json",
]);

const DEPLOYED_ORIGIN = "https://carloscarlosnwbuilder.pages.dev";
const LOCAL_HOSTNAMES = new Set(["localhost", "127.0.0.1", "[::1]"]);

const MAX_BODY_BYTES = 16 * 1024 * 1024;

/** A missing `Origin` is a non-browser client: browsers always send it on POST, so its
 *  absence cannot be a cross-site page in disguise. */
function originAllowed(origin: string | undefined): boolean {
  if (origin === undefined) return true;
  if (origin === DEPLOYED_ORIGIN) return true;
  try {
    const url = new URL(origin);
    return url.protocol === "http:" && LOCAL_HOSTNAMES.has(url.hostname);
  } catch {
    return false;
  }
}

function send(res: ServerResponse, status: number, body: unknown) {
  const text = JSON.stringify(body);
  res.statusCode = status;
  res.setHeader("content-type", "application/json");
  res.setHeader("content-length", Buffer.byteLength(text));
  res.end(text);
}

function setCorsHeaders(
  req: IncomingMessage,
  res: ServerResponse,
  origin: string,
) {
  res.setHeader("access-control-allow-origin", origin);
  res.setHeader("vary", "Origin");
  res.setHeader("access-control-allow-methods", "POST, OPTIONS");
  res.setHeader("access-control-allow-headers", "content-type");
  res.setHeader("access-control-max-age", "600");
  // Chrome gates public -> private-address requests on this handshake; its newer Local
  // Network Access model uses a permission prompt instead and ignores the header.
  if (req.headers["access-control-request-private-network"] === "true") {
    res.setHeader("access-control-allow-private-network", "true");
  }
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        req.destroy();
        reject(new Error("Body too large"));
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function parseRequest(text: string): { file: string; body: string } | null {
  let payload: unknown;
  try {
    payload = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof payload !== "object" || payload === null) return null;
  const { file, body } = payload as Record<string, unknown>;
  if (typeof file !== "string" || typeof body !== "string") return null;
  return { file, body };
}

/** `dataDir` is passed in rather than derived from this file's location: the plugin is
 *  bundled into a generated config module whose path says nothing about the repo. */
export async function handleWriteback(
  req: IncomingMessage,
  res: ServerResponse,
  dataDir: string,
): Promise<void> {
  const origin = req.headers.origin;
  if (!originAllowed(origin)) {
    send(res, 403, { ok: false, error: `Origin ${origin} is not allowed` });
    return;
  }
  if (origin !== undefined) setCorsHeaders(req, res, origin);

  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    res.end();
    return;
  }
  if (req.method !== "POST") {
    send(res, 405, { ok: false, error: "Use POST" });
    return;
  }
  if (!(req.headers["content-type"] ?? "").startsWith("application/json")) {
    send(res, 415, { ok: false, error: "Send application/json" });
    return;
  }

  let raw: string;
  try {
    raw = await readBody(req);
  } catch (error) {
    send(res, 413, { ok: false, error: (error as Error).message });
    return;
  }

  const request = parseRequest(raw);
  if (request === null) {
    send(res, 400, { ok: false, error: "Expected {file, body} as JSON" });
    return;
  }
  if (!WRITABLE_FILES.has(request.file)) {
    send(res, 400, {
      ok: false,
      error: `${request.file} is not one of the writable data files`,
    });
    return;
  }

  const repo = path.dirname(dataDir);
  try {
    await writeFile(path.join(dataDir, request.file), request.body, "utf8");
  } catch (error) {
    send(res, 500, { ok: false, error: (error as Error).message });
    return;
  }
  send(res, 200, {
    ok: true,
    repo,
    file: request.file,
    bytes: Buffer.byteLength(request.body),
  });
}

/** Dev-server half. `configureServer` never runs for a build, so nothing here reaches `dist`. */
export function writebackPlugin(): Plugin {
  return {
    name: "data-writeback",
    configureServer(server) {
      const dataDir = path.join(server.config.root, "data");
      const handle: Connect.NextHandleFunction = (req, res, next) => {
        handleWriteback(req, res, dataDir).catch(next);
      };
      // Front of the stack, not `server.middlewares.use`: Vite installs its own CORS
      // middleware before plugin hooks run, and it answers preflights itself, without the
      // private-network header Chrome requires of a page on a public origin.
      server.middlewares.stack.unshift({ route: WRITEBACK_PATH, handle });
    },
  };
}
