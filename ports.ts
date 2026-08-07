// ports.ts
import crypto from "node:crypto";

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
