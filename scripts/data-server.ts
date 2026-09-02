// Standalone host for the writeback handler, for saving from the deployed site. Needed only
// when `npm run dev` is not running: that serves the same handler on the same port, and the
// two cannot both hold it. Bound to 127.0.0.1.
import { createServer } from "node:http";
import path from "node:path";
import { handleWriteback, WRITEBACK_PATH, WRITEBACK_PORT } from "./writeback";

// npm runs scripts with the package root as cwd, which is the worktree this write belongs to.
const dataDir = path.join(process.cwd(), "data");

const server = createServer((req, res) => {
  if ((req.url ?? "").split("?")[0] !== WRITEBACK_PATH) {
    res.statusCode = 404;
    res.end();
    return;
  }
  void handleWriteback(req, res, dataDir);
});

server.listen(WRITEBACK_PORT, "127.0.0.1", () => {
  console.log(
    `Writing to ${dataDir} for POSTs to http://localhost:${WRITEBACK_PORT}${WRITEBACK_PATH}`,
  );
});
