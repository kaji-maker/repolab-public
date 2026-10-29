import { Store } from "../../packages/storage/store.ts";
import { createQualifiedServer } from "./qualified-server-v2.ts";
import { auditWorkbench } from "../../packages/repositories/preact-workbench-protocol-v2.ts";
const port = Number(process.env.REPOLAB_PORT ?? 4185);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw Error("Invalid REPOLAB_PORT");
const store = new Store(process.env.REPOLAB_STATE_PATH ?? ".repolab/state.sqlite");
auditWorkbench();
// No admission is provisioned by this entrypoint. Credentials alone cannot enable dispatch.
const service = createQualifiedServer(store, "dist/qualified-v5", port);
await service.start();
console.log(`ReproLab qualified V4 workbench: http://127.0.0.1:${port}`);
const stop = () => { void service.close().finally(() => { store.close(); process.exit(0); }); };
process.once("SIGINT", stop); process.once("SIGTERM", stop);
