import { defineConfig, type Plugin } from "vite";
import vue from "@vitejs/plugin-vue";
import tailwindcss from "@tailwindcss/vite";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import { DEV_PORT } from "./ports";

const require_ = createRequire(import.meta.url);

/**
 * tesseract.js fetches its WASM core, its worker script and its language model from jsDelivr
 * at runtime unless told otherwise. This serves all three from their npm packages instead, at
 * stable URLs, in dev and in the build alike -- a static build should not have a third-party
 * CDN on its critical path, and the paths are pinned by `package.json` rather than by whatever
 * the CDN serves that day.
 *
 * Nothing is copied into `public/`: these are verbatim package contents, so the packages stay
 * the single source of truth and no vendored binaries land in the repo.
 *
 * Only the LSTM cores are served. `createWorker` defaults to `OEM.LSTM_ONLY`, which is what
 * the engine comparison measured, and the runtime picks one of the three by feature detection.
 * Likewise `4.0.0_best_int` is the model variant that default asks for.
 */
const TESSERACT_ASSETS: Record<string, string> = {
  "/tessdata/eng.traineddata.gz":
    "@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz",
  "/tesseract/worker.min.js": "tesseract.js/dist/worker.min.js",
  "/tesseract/tesseract-core-lstm.wasm.js":
    "tesseract.js-core/tesseract-core-lstm.wasm.js",
  "/tesseract/tesseract-core-simd-lstm.wasm.js":
    "tesseract.js-core/tesseract-core-simd-lstm.wasm.js",
  "/tesseract/tesseract-core-relaxedsimd-lstm.wasm.js":
    "tesseract.js-core/tesseract-core-relaxedsimd-lstm.wasm.js",
};

const tesseractAssets = (): Plugin => {
  const resolved = Object.fromEntries(
    Object.entries(TESSERACT_ASSETS).map(([url, spec]) => [
      url,
      require_.resolve(spec),
    ]),
  );
  return {
    name: "tesseract-assets",
    configureServer(server) {
      for (const [url, file] of Object.entries(resolved)) {
        server.middlewares.use(url, (_req, res) => {
          readFile(file).then((data) => {
            if (url.endsWith(".gz"))
              res.setHeader("Content-Type", "application/gzip");
            else if (url.endsWith(".js"))
              res.setHeader("Content-Type", "text/javascript");
            res.end(data);
          });
        });
      }
    },
    async generateBundle() {
      for (const [url, file] of Object.entries(resolved)) {
        this.emitFile({
          type: "asset",
          fileName: url.slice(1),
          source: await readFile(file),
        });
      }
    },
  };
};

export default defineConfig({
  plugins: [vue(), tailwindcss(), tesseractAssets()],
  server: {
    port: DEV_PORT,
    strictPort: true,
  },
  build: {
    outDir: "dist",
  },
});
