import { randomUUID } from "node:crypto";
import { z } from "zod";
import { Hono } from "hono";
import { createFreshPreactApp as createApp } from "./preact-repair-v2.ts";
import type { Store } from "../../packages/storage/store.ts";
import {
  exportNativePreactPack,
  readNativePreactPack,
  NATIVE_PACK_LIMIT,
} from "../../packages/repositories/preact-pack-v3.ts";
import {
  NativePreactHistory,
  nativeReplayReadiness,
  replayNativePreact,
} from "../../packages/repositories/preact-replay-v4.ts";
import type { NativePreactPack } from "../../packages/repositories/preact-pack-v3.ts";
export interface NativeProductBackend {
  pack: () => NativePreactPack;
  readiness: () => ReturnType<typeof nativeReplayReadiness>;
  list: () => Promise<any[]>;
  get: (id: string) => Promise<any>;
  replay: (
    id: string,
    pack: NativePreactPack,
    signal: AbortSignal,
  ) => Promise<unknown>;
}
export function createLatestSelectedPackApp(
  store: Store,
  port = 4173,
  backend?: NativeProductBackend,
) {
  const base = createApp(store, port),
    history = new NativePreactHistory(),
    tasks = new Set<Promise<unknown>>(),
    nativeActive = new Set<string>();
  const b: NativeProductBackend = backend ?? {
    pack: exportNativePreactPack,
    readiness: nativeReplayReadiness,
    list: () => history.list(),
    get: (id) => history.get(id),
    replay: (id, pack, signal) =>
      replayNativePreact(pack, { id, signal, entrypoint: "api" }),
  };
  const native = new Hono();
  native.get("/", async (c) => {
    const pack = b.pack();
    return c.json({
      selection: pack.origin,
      sourceHash: pack.source.sha256,
      replay: b.readiness(),
      history: await b.list(),
      scope:
        "One exposed selected Preact feature; zero-inference native replay",
    });
  });
  native.get("/pack", (c) => {
    const p = b.pack();
    c.header(
      "Content-Disposition",
      'attachment; filename="preact-selected-f8bfb85d-pack.json"',
    );
    return c.body(JSON.stringify(p) + "\n", 200, {
      "Content-Type": "application/json; charset=utf-8",
    });
  });
  native.get("/patch", (c) => {
    const p = b.pack();
    c.header(
      "Content-Disposition",
      'attachment; filename="preact-ref-cleanup.patch"',
    );
    return c.text(p.patch.content);
  });
  native.get("/replays/:id", async (c) => {
    const id = z.uuid().safeParse(c.req.param("id"));
    if (!id.success) return c.json({ error: "Replay not found" }, 404);
    const r = await b.get(id.data);
    return r ? c.json(r) : c.json({ error: "Replay not found" }, 404);
  });
  native.post("/replays", async (c) => {
    if (base.active.size)
      return c.json({ error: "One workflow is already active" }, 409);
    if (!c.req.header("Content-Type")?.startsWith("application/json"))
      return c.json({ error: "Expected application/json" }, 415);
    const text = await c.req.text();
    if (Buffer.byteLength(text) > NATIVE_PACK_LIMIT + 20)
      return c.json({ error: "Native pack request too large" }, 413);
    let pack: NativePreactPack;
    try {
      const input = z
        .union([z.strictObject({}), z.strictObject({ pack: z.unknown() })])
        .parse(JSON.parse(text));
      pack = "pack" in input ? readNativePreactPack(input.pack) : b.pack();
    } catch {
      return c.json(
        {
          error:
            "Use the qualified Preact pack without source, test, command or provider overrides",
        },
        400,
      );
    }
    const ready = b.readiness();
    if (!ready.available) return c.json({ error: ready.reason }, 409);
    if (base.active.size)
      return c.json({ error: "One workflow is already active" }, 409);
    const id = randomUUID(),
      abort = new AbortController();
    base.active.set(id, abort);
    nativeActive.add(id);
    const task = Promise.resolve().then(() => b.replay(id, pack, abort.signal));
    tasks.add(task);
    void task
      .catch(() =>
        console.error(
          "Native replay stopped; retained evidence requires review",
        ),
      )
      .finally(() => {
        base.active.delete(id);
        nativeActive.delete(id);
        tasks.delete(task);
      });
    return c.json({ id }, 202);
  });
  native.post("/replays/:id/cancel", (c) => {
    const id = z.uuid().safeParse(c.req.param("id"));
    if (!id.success) return c.json({ error: "Replay not active" }, 409);
    const abort = base.active.get(id.data);
    if (!abort || !nativeActive.has(id.data))
      return c.json({ error: "Replay not active" }, 409);
    abort.abort();
    return c.json({ status: "cancellation-requested" }, 202);
  });
  base.app.route("/api/native-selected-v4", native);
  return {
    ...base,
    close: async () => {
      await base.close();
      await Promise.allSettled(tasks);
    },
  };
}
