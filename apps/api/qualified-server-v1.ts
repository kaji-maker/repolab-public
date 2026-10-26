import { createServer } from "node:http";
import { readFile, lstat } from "node:fs/promises";
import { resolve, extname, relative, join } from "node:path";
import type { Store } from "../../packages/storage/store.ts";
import { createQualifiedPreactApp, type ProductOptions } from "./preact-repair-v4.ts";

export function createQualifiedServer(store: Store, directory = "dist/qualified-v4", port = 4185, options: ProductOptions = {}) {
  const root = resolve(directory);
  let boundPort = port, service: ReturnType<typeof createQualifiedPreactApp> | undefined;
  const server = createServer(async (incoming, outgoing) => {
    try {
      const host = incoming.headers.host;
      if (![`127.0.0.1:${boundPort}`, `localhost:${boundPort}`].includes(host ?? "")) {
        outgoing.writeHead(403); outgoing.end("Local access only"); return;
      }
      const url = new URL(incoming.url ?? "/", `http://${host}`);
      if (url.pathname.startsWith("/api/")) {
        const chunks: Buffer[] = []; let size = 0;
        for await (const chunk of incoming) {
          size += chunk.length;
          if (size > 16000) { outgoing.writeHead(413); outgoing.end("Request too large"); return; }
          chunks.push(chunk);
        }
        const headers = new Headers();
        for (const [name, value] of Object.entries(incoming.headers)) if (value) headers.set(name, Array.isArray(value) ? value.join(",") : value);
        const response = await service!.app.fetch(new Request(url, { method: incoming.method, headers,
          ...(!["GET", "HEAD"].includes(incoming.method ?? "GET") ? { body: Buffer.concat(chunks) } : {}) }));
        outgoing.writeHead(response.status, Object.fromEntries(response.headers));
        outgoing.end(Buffer.from(await response.arrayBuffer())); return;
      }
      if (!["GET", "HEAD"].includes(incoming.method ?? "GET")) { outgoing.writeHead(405); outgoing.end(); return; }
      if (url.pathname === "/favicon.ico") { outgoing.writeHead(204); outgoing.end(); return; }
      const path = resolve(root, "." + (url.pathname === "/" ? "/native-repair-v8.html" : decodeURIComponent(url.pathname)));
      if (!path.startsWith(root + "/")) { outgoing.writeHead(403); outgoing.end(); return; }
      let cursor = root;
      for (const part of relative(root, path).split("/")) {
        cursor = join(cursor, part);
        if ((await lstat(cursor)).isSymbolicLink()) { outgoing.writeHead(403); outgoing.end(); return; }
      }
      const data = await readFile(path);
      const mime: Record<string, string> = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml" };
      outgoing.writeHead(200, { "Content-Type": mime[extname(path)] ?? "application/octet-stream",
        "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'",
        "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer", "Cache-Control": "no-store" });
      outgoing.end(incoming.method === "HEAD" ? undefined : data);
    } catch (error) {
      const missing = (error as NodeJS.ErrnoException).code === "ENOENT";
      outgoing.writeHead(missing ? 404 : 500); outgoing.end(missing ? "Page unavailable; build the qualified V4 workbench first." : "Local request failed");
    }
  });
  server.requestTimeout = 15000; server.headersTimeout = 10000; server.keepAliveTimeout = 30000;
  return { server, start: async () => {
    await new Promise<void>((ok, fail) => { server.once("error", fail); server.listen(port, "127.0.0.1", ok); });
    boundPort = (server.address() as { port: number }).port;
    service = createQualifiedPreactApp(store, boundPort, options);
    return boundPort;
  }, close: async () => { await service?.close(); await new Promise<void>(ok => server.close(() => ok())); } };
}
