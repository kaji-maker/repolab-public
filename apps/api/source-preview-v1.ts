import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { Store } from "../../packages/storage/store.ts";
import { createQualifiedServer } from "./qualified-server-v2.ts";

/** Source-only preview. No admission, private history, provider configuration or recovery. */
export function createSourcePreview(port = 4188, statePath = ".repolab/source-preview.sqlite") {
  const store = new Store(statePath);
  const service = createQualifiedServer(store, "dist/qualified-v5", port, {
    history: {
      list: async () => [], get: async () => null,
      patch: async () => { throw Error("Private audited history is not part of the source preview"); },
    },
    blocked: () => true,
    execute: async () => { throw Error("Fresh execution is unavailable in the source preview"); },
  });
  return { start: service.start, close: async () => { await service.close(); store.close(); } };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const service = createSourcePreview();
  const port = await service.start();
  console.log(`ReproLab source preview: http://127.0.0.1:${port}`);
  console.log("Inference: none. Execution: local empty-history preview only; use the portable V2 bundle to review recorded evidence. No fresh dispatch.");
  for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, () => { void service.close(); });
}
