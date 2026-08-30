// ports.ts
//
// Run directly with `npm run port` to print this worktree's dev port to stdout -
// useful for agents that need the port without importing this module (e.g. to
// curl the dev server or open it in a browser).
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const isAgent =
  process.env.AGENT != null ||
  process.env.PI_CODING_AGENT != null ||
  process.env.CLAUDECODE != null;

const folder = import.meta.dirname;

function worktreePort(base: number): number {
  const hash = crypto.createHash("md5").update(folder).digest();

  return base + (hash.readUInt16BE(0) % 1000);
}

export function getPort(defaultPort: number): number {
  return isAgent ? worktreePort(defaultPort) : defaultPort;
}

export const DEV_PORT = getPort(5173);

// Only print when this file is the entry point (`tsx ports.ts`), not when it's
// imported by vite.config.ts, playwright.config.ts, etc.
const isMain =
  process.argv[1] != null && fileURLToPath(import.meta.url) === process.argv[1];

if (isMain) {
  console.log(DEV_PORT);
}
