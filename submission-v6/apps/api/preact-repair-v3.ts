import { Hono } from "hono";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { z } from "zod";
import type { Store } from "../../packages/storage/store.ts";
import { createLatestSelectedPackApp } from "./preact-product-v4.ts";
import {
  FreshPreactHistory,
  freshPreactReadiness,
  unresolvedGuardedPreactExecution,
} from "../../packages/repositories/preact-repair-history-v3.ts";
import { runFreshPreact } from "../../packages/repositories/preact-repair-v3.ts";
import { recoverFreshPreactExecution } from "../../packages/repositories/preact-repair-recovery-v1.ts";
export interface GuardedPreactBackend {
  readiness: typeof freshPreactReadiness;
  list(): Promise<unknown>;
  get(id: string): Promise<unknown>;
  patch(id: string): Promise<string>;
  run(id: string, signal: AbortSignal): Promise<unknown>;
  recover(id: string, signal: AbortSignal): Promise<unknown>;
  blocked(): boolean;
}
/** Current product perimeter; old endpoints remain available for reading historical evidence. */
export function createGuardedPreactApp(
  store: Store,
  port = 4184,
  backend?: GuardedPreactBackend,
) {
  const base = createLatestSelectedPackApp(store, port),
    history = new FreshPreactHistory();
  const b: GuardedPreactBackend = backend ?? {
    readiness: freshPreactReadiness,
    list: () => history.list(),
    get: (id) => history.get(id),
    patch: (id) => history.patch(id),
    run: (id, signal) => runFreshPreact({ id, signal, entrypoint: "api" }),
    recover: (id, signal) => recoverFreshPreactExecution(id, signal),
    blocked: () =>
      store.hasUnsettledCharges() ||
      unresolvedGuardedPreactExecution() ||
      [
        ".repolab/clsx-repair.lock",
        ".repolab/repositories/clsx-repair.lock",
      ].some(existsSync),
  };
  const app = new Hono(),
    api = new Hono();
  const own = new Set<string>(),
    tasks = new Set<Promise<unknown>>();
  const origins = new Set([
    `http://127.0.0.1:${port}`,
    `http://localhost:${port}`,
    "http://127.0.0.1:5173",
    "http://localhost:5173",
  ]);
  app.use("/api/*", async (c, next) => {
    const url = new URL(c.req.url),
      origin = c.req.header("Origin");
    if (
      !["localhost", "127.0.0.1"].includes(url.hostname) ||
      (origin && !origins.has(origin)) ||
      c.req.header("Sec-Fetch-Site") === "cross-site"
    )
      return c.json({ error: "Untrusted local request" }, 403);
    c.header("Cache-Control", "no-store");
    c.header("X-Content-Type-Options", "nosniff");
    const exempt =
      /^\/api\/native-preact-repairs-v3\/[0-9a-f-]+\/recover$/.test(
        url.pathname,
      ) || url.pathname.endsWith("/cancel");
    if (c.req.method === "POST" && !exempt && b.blocked())
      return c.json(
        {
          error:
            "Unresolved execution or another workflow retains the shared lease",
        },
        409,
      );
    if (
      c.req.method === "POST" &&
      /^\/api\/native-preact-repairs(?:-v2)?\/?$/.test(url.pathname)
    )
      return c.json(
        { error: "Start new repairs through the guarded v3 workbench" },
        409,
      );
    await next();
  });
  api.get("/", async (c) =>
    c.json({
      readiness: b.readiness(),
      history: await b.list(),
      profile: "preactjs__preact-4436",
      inference: "Nemotron full thinking; up to 3 candidates",
      execution: "Nebius Sandbox; guarded uncertainty and read-only recovery",
    }),
  );
  api.get("/:id", async (c) => {
    const id = z.uuid().safeParse(c.req.param("id"));
    if (!id.success) return c.json({ error: "Repair not found" }, 404);
    const result = await b.get(id.data);
    return result ? c.json(result) : c.json({ error: "Repair not found" }, 404);
  });
  api.get("/:id/patch", async (c) => {
    const id = z.uuid().safeParse(c.req.param("id"));
    if (!id.success) return c.json({ error: "Repair not found" }, 404);
    try {
      const patch = await b.patch(id.data);
      c.header(
        "Content-Disposition",
        `attachment; filename="preact-${id.data}.patch"`,
      );
      return c.text(patch);
    } catch {
      return c.json(
        { error: "Patch requires audited independent correctness" },
        409,
      );
    }
  });
  api.use("*", async (c, next) => {
    if (c.req.method !== "POST") return next();
    if (!c.req.header("Content-Type")?.startsWith("application/json"))
      return c.json({ error: "Expected application/json" }, 415);
    const text = await c.req.text();
    if (Buffer.byteLength(text) > 16000)
      return c.json({ error: "Request too large" }, 413);
    try {
      z.strictObject({}).parse(JSON.parse(text));
    } catch {
      return c.json(
        {
          error: "No source, test, provider or operation overrides are allowed",
        },
        400,
      );
    }
    await next();
  });
  api.post("/", (c) => {
    if (base.active.size)
      return c.json({ error: "One workflow is already active" }, 409);
    const ready = b.readiness();
    if (!ready.available) return c.json({ error: ready.reason }, 409);
    const id = randomUUID(),
      abort = new AbortController();
    base.active.set(id, abort);
    own.add(id);
    const task = Promise.resolve().then(() => b.run(id, abort.signal));
    tasks.add(task);
    void task
      .catch(() => console.error("Guarded repair stopped; no automatic retry"))
      .finally(() => {
        base.active.delete(id);
        own.delete(id);
        tasks.delete(task);
      });
    return c.json({ id }, 202);
  });
  api.post("/:id/cancel", (c) => {
    const id = z.uuid().safeParse(c.req.param("id"));
    if (!id.success || !own.has(id.data))
      return c.json({ error: "Repair not active" }, 409);
    base.active.get(id.data)!.abort();
    return c.json({ status: "cancellation-requested" }, 202);
  });
  api.post("/:id/recover", async (c) => {
    const id = z.uuid().safeParse(c.req.param("id"));
    if (!id.success) return c.json({ error: "Repair not found" }, 404);
    if (base.active.size)
      return c.json(
        { error: "Stop active workflows before read-only recovery" },
        409,
      );
    const abort = new AbortController();
    base.active.set(id.data, abort);
    const task = Promise.resolve().then(() => b.recover(id.data, abort.signal));
    tasks.add(task);
    try {
      return c.json(await task);
    } catch {
      return c.json(
        { error: "Execution remains unresolved; evidence and leases retained" },
        409,
      );
    } finally {
      base.active.delete(id.data);
      tasks.delete(task);
    }
  });
  app.route("/api/native-preact-repairs-v3", api);
  app.route("/", base.app);
  app.onError((_e, c) =>
    c.json({ error: "Local workflow evidence unavailable" }, 500),
  );
  return {
    app,
    active: base.active,
    close: async () => {
      await base.close();
      await Promise.allSettled(tasks);
    },
  };
}
