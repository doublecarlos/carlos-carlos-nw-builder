// Browser half of "Save to repo": POSTs a composed data file to the local writeback endpoint
// (scripts/writeback.ts).
//
// A locally served page keeps the request same-origin -- no CORS, no port to know, and it
// targets whichever worktree served it even when ports.ts has moved that off 5173. Only the
// deployed site names an absolute address.
//
// Reachability is decided by the write itself rather than a probe, which could only report
// what was true a moment before the POST.

/** Must match `scripts/writeback.ts`; a unit test holds the two together. */
const WRITEBACK_PATH = "/__data/write";

const WRITEBACK_ORIGIN = "http://localhost:5173";
const LOCAL_HOSTNAMES = new Set(["localhost", "127.0.0.1", "[::1]"]);

export interface WriteResult {
  /** Absolute path of the repo the file landed in, shown back so the worktree that took the
   *  write is visible rather than assumed. */
  repo: string;
}

/** Message is written for the person who clicked, not for a log. */
export class WritebackError extends Error {}

export function writebackUrl(hostname: string): string {
  return LOCAL_HOSTNAMES.has(hostname)
    ? WRITEBACK_PATH
    : `${WRITEBACK_ORIGIN}${WRITEBACK_PATH}`;
}

/** Anything not shaped like the endpoint's own answer -- a 404 page, another server on the
 *  port -- means nothing there knows what a write is. */
function asPayload(
  value: unknown,
): { ok: boolean; repo?: string; error?: string } | null {
  if (typeof value !== "object" || value === null) return null;
  const { ok } = value as Record<string, unknown>;
  return typeof ok === "boolean"
    ? (value as { ok: boolean; repo?: string; error?: string })
    : null;
}

export async function writeDataFile(
  file: string,
  body: string,
): Promise<WriteResult> {
  const url = writebackUrl(location.hostname);
  const where = url.startsWith("/") ? "this dev server" : WRITEBACK_ORIGIN;

  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      // Load-bearing for the endpoint's refusal of cross-origin writes: see scripts/writeback.ts.
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ file, body }),
    });
  } catch {
    throw new WritebackError(
      `Could not reach ${where} - start it with \`npm run dev\` or \`npm run data-server\` and try again`,
    );
  }

  let payload: ReturnType<typeof asPayload> = null;
  try {
    payload = asPayload(await response.json());
  } catch {
    payload = null;
  }
  if (payload === null) {
    throw new WritebackError(
      `${where} answered, but not as a writeback server - is something else on that port?`,
    );
  }
  if (!payload.ok || payload.repo === undefined) {
    throw new WritebackError(payload.error ?? `Writing ${file} failed`);
  }
  return { repo: payload.repo };
}
