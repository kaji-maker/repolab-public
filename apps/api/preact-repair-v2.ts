import { Hono } from "hono";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Store } from "../../packages/storage/store.ts";
import { createSelectedPackRecoveryApp } from "./preact-product-v3.ts";
import {
  FreshPreactHistory,
  freshPreactReadiness,
} from "../../packages/repositories/preact-repair-history-v2.ts";
import { runFreshPreact } from "../../packages/repositories/preact-repair-v2.ts";
export interface FreshPreactBackend {
  readiness: typeof freshPreactReadiness;
  list: () => Promise<unknown>;
  get: (id: string) => Promise<unknown>;
  patch: (id: string) => Promise<string>;
  run: (id: string, signal: AbortSignal) => Promise<unknown>;
}
export function createFreshPreactApp(
  store: Store,
  port = 4184,
  backend?: FreshPreactBackend,
) {
  const base = createSelectedPackRecoveryApp(store, port),
    history = new FreshPreactHistory();
  const tasks = new Set<Promise<unknown>>(),
    own = new Set<string>();
  const b = backend ?? {
    readiness: freshPreactReadiness,
    list: () => history.list(),
    get: (id: string) => history.get(id),
    patch: (id: string) => history.patch(id),
    run: (id: string, signal: AbortSignal) =>
      runFreshPreact({ id, signal, entrypoint: "api" }),
  };
  const api = new Hono();
  api.get("/", async (c) =>
    c.json({
      readiness: b.readiness(),
      history: await b.list(),
      profile: "preactjs__preact-4436",
      inference:
        "Fresh Nebius full-thinking requests, maximum 3 candidates; no monetary cap",
      execution:
        "Isolated Nebius Sandbox; original tests and independent checks preserved",
    }),
  );
  api.get("/:id", async (c) => {
    const id = z.uuid().safeParse(c.req.param("id"));
    if (!id.success) return c.json({ error: "Repair not found" }, 404);
    const r = await b.get(id.data);
    return r ? c.json(r) : c.json({ error: "Repair not found" }, 404);
  });
  api.get("/:id/patch", async (c) => {
    const id = z.uuid().safeParse(c.req.param("id"));
    if (!id.success) return c.json({ error: "Repair not found" }, 404);
    try {
      const patch = await b.patch(id.data);
      c.header(
        "Content-Disposition",
        'attachment; filename="preact-' + id.data + '.patch"',
      );
      return c.text(patch);
    } catch {
      return c.json(
        { error: "Patch requires audited independent correctness" },
        409,
      );
    }
  });
  api.post("/", async (c) => {
    if (base.active.size)
      return c.json({ error: "One workflow is already active" }, 409);
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
          error:
            "Use the qualified profile without report, source, test, model or provider overrides",
        },
        400,
      );
    }
    const readiness = b.readiness();
    if (!readiness.available) return c.json({ error: readiness.reason }, 409);
    if (base.active.size)
      return c.json({ error: "One workflow is already active" }, 409);
    const id = randomUUID(),
      controller = new AbortController();
    base.active.set(id, controller);
    own.add(id);
    const task = Promise.resolve().then(() => b.run(id, controller.signal));
    tasks.add(task);
    void task
      .catch(() =>
        console.error("Fresh native repair stopped; no automatic retry"),
      )
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
  base.app.route("/api/native-preact-repairs-v2", api);
  return {
    ...base,
    close: async () => {
      await base.close();
      await Promise.allSettled(tasks);
    },
  };
}
