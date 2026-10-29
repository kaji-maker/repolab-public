import { Store } from "../../packages/storage/store.ts";
import { createQualifiedServer } from "./qualified-server-v3.ts";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export function createSourcePreviewV2(port = 4188, statePath = ".repolab/source-preview-v5.sqlite") {
  const store = new Store(statePath);
  const service = createQualifiedServer(store, "dist/qualified-v6", port, {
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
  const service = createSourcePreviewV2(Number(process.argv[2] ?? 4188));
  const port = await service.start();
  console.log(`V5 read-only source preview: http://127.0.0.1:${port}`);
  console.log("Inference: none. Execution: read-only local preview; live admission unavailable.");
  for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, () => void service.close());
}
