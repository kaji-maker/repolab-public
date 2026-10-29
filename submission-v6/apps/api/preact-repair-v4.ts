import { Hono } from "hono";
import { existsSync } from "node:fs";
import { z } from "zod";
import type { Store } from "../../packages/storage/store.ts";
import { FreshPreactHistory, unresolvedGuardedPreactExecution } from "../../packages/repositories/preact-repair-history-v4.ts";
import { freshPreactReadiness, unresolvedGuardedPreactExecution as unresolvedV3 } from "../../packages/repositories/preact-repair-history-v3.ts";
import { runFreshPreact } from "../../packages/repositories/preact-repair-v4.ts";

export interface ProductAdmission {
  id: string;
  readiness(): { available: boolean; reason: string };
  /** Server-only capability: verifies and consumes a separate fresh execution freeze. */
  consume(): Promise<void>;
}
export interface ProductOptions {
  history?: Pick<FreshPreactHistory, "list" | "get" | "patch">;
  admission?: ProductAdmission;
  execute?: typeof runFreshPreact;
  blocked?: () => boolean;
}
/** Standalone V4 perimeter. No legacy dispatch routes or automatic recovery are mounted. */
export function createQualifiedPreactApp(store: Store, port = 4185, options: ProductOptions = {}) {
  const app = new Hono(), history = options.history ?? new FreshPreactHistory();
  const active = new Map<string, AbortController>(), tasks = new Set<Promise<unknown>>();
  let consumed = false;
  const origins = new Set([`http://127.0.0.1:${port}`, `http://localhost:${port}`]);
  const blocked = () => store.hasUnsettledCharges() || unresolvedV3() || unresolvedGuardedPreactExecution() ||
    [".repolab/clsx-repair.lock", ".repolab/repositories/clsx-repair.lock"].some(existsSync) || !!options.blocked?.();
  const readiness = () => {
    if (!options.admission || consumed) return { available: false, reason: "Review completed runs below. Another model repair needs a new approved run." };
    if (active.size || blocked()) return { available: false, reason: "An active workflow, unresolved execution or inference accounting blocks another run." };
    const ready = options.admission.readiness();
    if (!ready.available) return ready;
    return options.execute ? ready : freshPreactReadiness();
  };
  app.use("/api/*", async (c, next) => {
    const url = new URL(c.req.url), origin = c.req.header("Origin");
    if (!origins.has(url.origin) || (origin && !origins.has(origin)) || c.req.header("Sec-Fetch-Site") === "cross-site")
      return c.json({ error: "Untrusted local request" }, 403);
    c.header("Cache-Control", "no-store"); c.header("X-Content-Type-Options", "nosniff");
    if (c.req.method === "POST") {
      if (!url.pathname.startsWith("/api/native-preact-repairs-v4")) return c.json({ error: "Historical dispatch is unavailable in this workbench" }, 409);
      if (c.req.header("Content-Type")?.split(";")[0] !== "application/json") return c.json({ error: "Expected application/json" }, 415);
      const text = await c.req.text();
      if (Buffer.byteLength(text) > 16000) return c.json({ error: "Request too large" }, 413);
      try { z.strictObject({}).parse(JSON.parse(text)); }
      catch { return c.json({ error: "Source, test, model, credential and run overrides are not allowed" }, 400); }
    }
    await next();
  });
  const api = new Hono();
  api.get("/", async c => c.json({ readiness: readiness(), history: await history.list(),
    profile: "preactjs__preact-4436", engine: "V4", evidence: "Saved runs; reviewing creates no inference or execution" }));
  api.get("/:id", async c => {
    const id = z.uuid().safeParse(c.req.param("id"));
    if (!id.success) return c.json({ error: "Repair not found" }, 404);
    const record = await history.get(id.data);
    return record ? c.json(record) : c.json({ error: "Repair not found" }, 404);
  });
  api.get("/:id/patch", async c => {
    const id = z.uuid().safeParse(c.req.param("id"));
    if (!id.success) return c.json({ error: "Repair not found" }, 404);
    try {
      const patch = await history.patch(id.data);
      c.header("Content-Disposition", `attachment; filename="preact-${id.data}.patch"`);
      return c.text(patch);
    } catch { return c.json({ error: "Patch requires audited independent correctness" }, 409); }
  });
  api.post("/", c => {
    const ready = readiness();
    if (!ready.available) return c.json({ error: ready.reason }, 409);
    const id = z.uuid().parse(options.admission!.id), abort = new AbortController();
    // Consume the capability before awaiting anything; failures never restore it.
    consumed = true; active.set(id, abort);
    const task = Promise.resolve().then(async () => {
      await options.admission!.consume();
      abort.signal.throwIfAborted();
      return (options.execute ?? runFreshPreact)({ id, signal: abort.signal, entrypoint: "api" });
    });
    tasks.add(task);
    void task.catch(() => console.error("V4 workflow stopped; no automatic retry")).finally(() => { active.delete(id); tasks.delete(task); });
    return c.json({ id }, 202);
  });
  api.post("/:id/cancel", c => {
    const id = z.uuid().safeParse(c.req.param("id"));
    if (!id.success || !active.has(id.data)) return c.json({ error: "Repair not active" }, 409);
    active.get(id.data)!.abort(); return c.json({ status: "cancellation-requested" }, 202);
  });
  api.post("/:id/recover", c => c.json({ error: "Saved execution needs separately reviewed read-only recovery; no automatic retry" }, 409));
  app.route("/api/native-preact-repairs-v4", api);
  app.onError((_error, c) => c.json({ error: "Local workflow evidence unavailable" }, 500));
  return { app, active, close: async () => { for (const abort of active.values()) abort.abort(); await Promise.allSettled(tasks); } };
}
