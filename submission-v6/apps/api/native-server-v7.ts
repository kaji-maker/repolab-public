import { auditPreactBrowserV4 } from "../../packages/repositories/preact-browser-protocol-v4.ts";
import { NativePreactHistory as LatestPreactHistory } from "../../packages/repositories/preact-replay-v4.ts";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { resolve, extname } from "node:path";
import { Store } from "../../packages/storage/store.ts";
import { recoverInterruptedRuns } from "./app.ts";
import { createLatestSelectedPackApp } from "./preact-product-v4.ts";
import { NativePreactHistory } from "../../packages/repositories/preact-replay-v1.ts";
import { NativePreactHistory as SelectedPreactHistory } from "../../packages/repositories/preact-replay-v2.ts";
import { NativePreactHistory as SelectedPreactRecoveryHistory } from "../../packages/repositories/preact-replay-v3.ts";
import { FreshPreactHistory as RevisedFreshPreactHistory } from "../../packages/repositories/preact-repair-history-v2.ts";
import { FreshPreactHistory } from "../../packages/repositories/preact-repair-history-v1.ts";
import { PortableHistory } from "../../packages/repositories/portable-replay.ts";
import { ReplayHistory } from "../../packages/repositories/pack-replay.ts";
import { RepairHistory } from "../../packages/repositories/repair-history.ts";

const port = Number(process.env.REPOLAB_PORT ?? 4184);
if (!Number.isInteger(port) || port < 1024 || port > 65535)
  throw new Error("Invalid REPOLAB_PORT");
const root = resolve("dist/web");
const store = new Store(
  process.env.REPOLAB_STATE_PATH ?? resolve(".repolab/state.sqlite"),
);
recoverInterruptedRuns(store);
await new RepairHistory().recover();
await new ReplayHistory().recover();
await new PortableHistory().recover();
await new NativePreactHistory().recover();
await new FreshPreactHistory().recover();
await new RevisedFreshPreactHistory().recover();
await new SelectedPreactHistory().recover();
await new SelectedPreactRecoveryHistory().recover();
await new LatestPreactHistory().recover();
auditPreactBrowserV4();
const service = createLatestSelectedPackApp(store, port);
const mime: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".json": "application/json",
};
const server = createServer(async (incoming, outgoing) => {
  try {
    const host = incoming.headers.host;
    if (![`127.0.0.1:${port}`, `localhost:${port}`].includes(host ?? "")) {
      outgoing.writeHead(403);
      outgoing.end("Local access only");
      return;
    }
    const url = new URL(incoming.url ?? "/", `http://${host}`);
    if (url.pathname.startsWith("/api/")) {
      const chunks: Buffer[] = [];
      let size = 0;
      for await (const chunk of incoming) {
        size += chunk.length;
        if (
          size >
          ([
            "/api/native-preact/replays",
            "/api/native-selected-v2/replays",
            "/api/native-selected-v3/replays",
            "/api/native-selected-v4/replays",
          ].includes(url.pathname)
            ? 1_500_020
            : 16_000)
        ) {
          outgoing.writeHead(413);
          outgoing.end("Request too large");
          return;
        }
        chunks.push(chunk);
      }
      const headers = new Headers();
      for (const [name, value] of Object.entries(incoming.headers))
        if (value)
          headers.set(name, Array.isArray(value) ? value.join(",") : value);
      const request = new Request(url, {
        method: incoming.method,
        headers,
        ...(!["GET", "HEAD"].includes(incoming.method ?? "GET")
          ? { body: Buffer.concat(chunks) }
          : {}),
      });
      const response = await service.app.fetch(request);
      outgoing.writeHead(response.status, Object.fromEntries(response.headers));
      outgoing.end(Buffer.from(await response.arrayBuffer()));
    } else {
      const pathname = decodeURIComponent(url.pathname);
      if (!["GET", "HEAD"].includes(incoming.method ?? "GET")) {
        outgoing.writeHead(405);
        outgoing.end();
        return;
      }
      const path = resolve(
        root,
        "." +
          (pathname === "/"
            ? "/native-repair-v6.html"
            : pathname === "/workbench"
              ? "/index.html"
              : pathname),
      );
      if (!path.startsWith(root + "/")) {
        outgoing.writeHead(403);
        outgoing.end();
        return;
      }
      let data: Buffer;
      try {
        data = await readFile(path);
      } catch {
        outgoing.writeHead(404);
        outgoing.end("Run npm run build, then open the root URL.");
        return;
      }
      outgoing.writeHead(200, {
        "Content-Type": mime[extname(path)] ?? "application/octet-stream",
        "Content-Security-Policy":
          "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'",
        "X-Content-Type-Options": "nosniff",
        "Referrer-Policy": "no-referrer",
        "Cache-Control": "no-cache",
      });
      outgoing.end(incoming.method === "HEAD" ? undefined : data);
    }
  } catch {
    outgoing.writeHead(500);
    outgoing.end("Local request failed");
  }
});
server.requestTimeout = 15_000;
server.headersTimeout = 10_000;
server.keepAliveTimeout = 60_000;
server.listen(port, "127.0.0.1", () =>
  console.log(`ReproLab fresh native repair: http://127.0.0.1:${port}`),
);
const stop = () => {
  server.close();
  void service.close().finally(() => {
    store.close();
    process.exit(0);
  });
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
