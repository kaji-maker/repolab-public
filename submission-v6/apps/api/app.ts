import { Hono } from "hono";
import { IntakeSchema } from "../../packages/contracts/index.ts";
import type { Run } from "../../packages/contracts/index.ts";
import { Store } from "../../packages/storage/store.ts";
import { createRun, executeRun } from "../../packages/controller/run.ts";
import { FixtureProposer } from "../../packages/providers/fixture.ts";
import { TrustedFixtureExecutor } from "../../packages/execution/local.ts";
import { exportPack } from "../../packages/evidence/pack.ts";
import { profileSummaries } from "../../packages/profiles/index.ts";
import {
  clsxExecutionBlocker,
  clsxPreparationSummary,
} from "../../packages/repositories/clsx-contract.ts";
import {
  NebiusProposer,
  configFromEnv,
} from "../../packages/providers/nebius.ts";
import { sha256 } from "../../packages/evidence/hash.ts";
import {
  NebiusSandboxExecutor,
  sandboxConfigFromEnv,
} from "../../packages/execution/nebius.ts";
import { sandboxReady } from "../../packages/execution/readiness.ts";
import type { Executor } from "../../packages/contracts/index.ts";
import { randomUUID } from "node:crypto";
import { runClsxRepair } from "../../packages/repositories/repair-service.ts";
import { RepairHistory } from "../../packages/repositories/repair-history.ts";
import { repairReadiness } from "../../packages/repositories/repair-readiness.ts";
import { RepairStartSchema } from "../../packages/repositories/repair-view.ts";
import type { RepairReview } from "../../packages/repositories/repair-view.ts";
import type { ClsxPack } from "../../packages/repositories/repair-artifacts.ts";
import {
  replayClsxPack,
  replayReadiness,
  ReplayHistory,
} from "../../packages/repositories/pack-replay.ts";
import type { ReplayReview } from "../../packages/repositories/pack-replay.ts";
import {
  exportPortableSelection,
  portableCatalog,
  portableProfiles,
} from "../../packages/repositories/portable-pack.ts";
import type {
  PortablePack,
  PortableProfile,
} from "../../packages/repositories/portable-pack.ts";
import {
  PortableHistory,
  replayPortablePack,
  portableReplayReadiness,
} from "../../packages/repositories/portable-replay.ts";
import type { PortableReview } from "../../packages/repositories/portable-replay.ts";
import { z } from "zod";

export interface PortableBackend {
  catalog(): Promise<unknown>;
  pack(profile: PortableProfile): Promise<PortablePack>;
  readiness(): { available: boolean; reason: string };
  list(profile: PortableProfile): Promise<PortableReview[]>;
  get(id: string): Promise<PortableReview | null>;
  replay(
    id: string,
    profile: PortableProfile,
    signal: AbortSignal,
  ): Promise<unknown>;
}

export interface RepositoryRepairBackend {
  readiness(): { available: boolean; reason: string };
  list(): Promise<RepairReview[]>;
  get(id: string): Promise<RepairReview | null>;
  run(id: string, signal: AbortSignal): Promise<unknown>;
  artifacts?(id: string): Promise<ClsxPack>;
  replayReady?(): { available: boolean; reason: string };
  replays?(originId: string): Promise<ReplayReview[]>;
  replayGet?(id: string): Promise<ReplayReview | null>;
  replay?(id: string, originId: string, signal: AbortSignal): Promise<unknown>;
}

export function createApp(
  store: Store,
  port = 4173,
  repositoryBackend?: RepositoryRepairBackend,
  portableBackend?: PortableBackend,
) {
  const app = new Hono();
  const active = new Map<string, AbortController>();
  const tasks = new Map<string, Promise<unknown>>();
  const history = new RepairHistory();
  const replays = new ReplayHistory();
  const portableHistory = new PortableHistory();
  const portable: PortableBackend = portableBackend ?? {
    catalog: portableCatalog,
    pack: exportPortableSelection,
    readiness: portableReplayReadiness,
    list: (profile) => portableHistory.list(profile),
    get: (id) => portableHistory.get(id),
    replay: async (id, profile, signal) =>
      replayPortablePack(await exportPortableSelection(profile), {
        id,
        signal,
        entrypoint: "api",
      }),
  };
  const repository: RepositoryRepairBackend = repositoryBackend ?? {
    readiness: () => repairReadiness(store),
    list: () => history.list(),
    get: (id) => history.get(id),
    run: (id, signal) =>
      runClsxRepair({ store, id, signal, entrypoint: "api" }),
    artifacts: (id) => history.artifacts(id),
    replayReady: () => replayReadiness(),
    replays: (id) => replays.list(id),
    replayGet: (id) => replays.get(id),
    replay: async (id, originId, signal) =>
      replayClsxPack(await history.artifacts(originId), {
        id,
        signal,
        entrypoint: "api",
      }),
  };
  const isolatedReady = () =>
    process.env.REPOLAB_EXECUTION === "nebius-sandbox" &&
    sandboxReady(sandboxConfigFromEnv());
  const origins = new Set([
    `http://127.0.0.1:${port}`,
    `http://localhost:${port}`,
    "http://127.0.0.1:5173",
    "http://localhost:5173",
  ]);
  app.use("/api/*", async (c, next) => {
    const url = new URL(c.req.url);
    if (!["localhost", "127.0.0.1"].includes(url.hostname))
      return c.json({ error: "Local access only" }, 403);
    const origin = c.req.header("Origin");
    if (origin && !origins.has(origin))
      return c.json({ error: "Untrusted request origin" }, 403);
    if (c.req.header("Sec-Fetch-Site") === "cross-site")
      return c.json({ error: "Cross-site requests are disabled" }, 403);
    c.header("Cache-Control", "no-store");
    c.header("X-Content-Type-Options", "nosniff");
    await next();
  });
  app.get("/api/capabilities", (c) =>
    c.json({
      release: "local-milestone-0",
      fixtureAvailable: true,
      sandboxReady: isolatedReady(),
      inferenceConfigured: Boolean(process.env.NEBIUS_API_KEY),
      liveAvailable: Boolean(process.env.NEBIUS_API_KEY),
      liveReason: isolatedReady()
        ? "Live inference and isolated candidate verification are enabled after the sandbox smoke check."
        : "Live inference extracts the contract and proposes a patch. Original fixture tests run locally; generated patch verification awaits the sandbox smoke check.",
      model: process.env.NEBIUS_MODEL ?? "nvidia/nemotron-3-super-120b-a12b",
      profiles: profileSummaries,
      preparedProfiles: [clsxPreparationSummary],
      repositoryRepair: repository.readiness(),
      repositoryReplay: repository.replayReady?.() ?? {
        available: false,
        reason: "Replay backend unavailable",
      },
    }),
  );
  app.get("/api/repository-repairs", async (c) =>
    c.json(await repository.list()),
  );
  app.get("/api/portable-packs", async (c) =>
    c.json({ packs: await portable.catalog(), replay: portable.readiness() }),
  );
  app.get("/api/portable-packs/:profile/replays", async (c) => {
    const p = z.enum(portableProfiles).safeParse(c.req.param("profile"));
    return p.success
      ? c.json(await portable.list(p.data))
      : c.json({ error: "Unsupported pack" }, 404);
  });
  for (const kind of ["pack", "patch", "regression"] as const)
    app.get("/api/portable-packs/:profile/" + kind, async (c) => {
      const p = z.enum(portableProfiles).safeParse(c.req.param("profile"));
      if (!p.success) return c.json({ error: "Unsupported pack" }, 404);
      try {
        const pack = await portable.pack(p.data);
        c.header(
          "Content-Disposition",
          'attachment; filename="' +
            p.data +
            "-" +
            (kind === "patch"
              ? "repair.patch"
              : kind === "pack"
                ? "repair-pack.json"
                : "regression.json") +
            '"',
        );
        if (kind === "patch") return c.text(pack.patch.content);
        return kind === "pack"
          ? c.json(pack)
          : c.json({
              scope: "existing-public-report-and-compatibility-inputs",
              profile: pack.profile,
              report: pack.report,
              core: pack.publicCore,
              challenges: pack.publicChallenges,
            });
      } catch {
        return c.json(
          { error: "Complete validated selected pack unavailable" },
          409,
        );
      }
    });
  app.get("/api/portable-replays/:id", async (c) => {
    const r = await portable.get(c.req.param("id"));
    return r ? c.json(r) : c.json({ error: "Replay not found" }, 404);
  });
  app.post("/api/portable-packs/:profile/replay", async (c) => {
    const p = z.enum(portableProfiles).safeParse(c.req.param("profile"));
    if (!p.success) return c.json({ error: "Unsupported pack" }, 404);
    if (active.size)
      return c.json({ error: "One workflow is already active" }, 409);
    if (!c.req.header("Content-Type")?.startsWith("application/json"))
      return c.json({ error: "Expected application/json" }, 415);
    if ((await c.req.text()).trim() !== "{}")
      return c.json(
        {
          error: "Replay accepts no source, command or configuration overrides",
        },
        400,
      );
    const ready = portable.readiness();
    if (!ready.available) return c.json({ error: ready.reason }, 409);
    try {
      await portable.pack(p.data);
    } catch {
      return c.json({ error: "Validated selected pack required" }, 409);
    }
    if (active.size)
      return c.json({ error: "One workflow is already active" }, 409);
    const id = randomUUID(),
      abort = new AbortController();
    active.set(id, abort);
    const task = Promise.resolve().then(() =>
      portable.replay(id, p.data, abort.signal),
    );
    tasks.set(id, task);
    void task
      .catch(() =>
        console.error("Portable replay stopped; inspect retained evidence"),
      )
      .finally(() => {
        active.delete(id);
        tasks.delete(id);
      });
    return c.json({ id }, 202);
  });
  app.post("/api/portable-replays/:id/cancel", (c) => {
    const abort = active.get(c.req.param("id"));
    if (!abort) return c.json({ error: "Replay is not active" }, 409);
    abort.abort();
    return c.json({ status: "cancellation-requested" }, 202);
  });
  app.get("/api/repository-repairs/:id", async (c) => {
    const review = await repository.get(c.req.param("id"));
    return review ? c.json(review) : c.json({ error: "Repair not found" }, 404);
  });
  app.get("/api/repository-repairs/:id/review", async (c) => {
    if (active.has(c.req.param("id")))
      return c.json(
        { error: "Wait for completion before exporting review" },
        409,
      );
    const review = await repository.get(c.req.param("id"));
    if (!review) return c.json({ error: "Repair not found" }, 404);
    c.header(
      "Content-Disposition",
      `attachment; filename="repolab-repair-${review.id}.json"`,
    );
    return c.json(review);
  });
  app.get("/api/repository-repairs/:id/artifacts", async (c) => {
    if (active.has(c.req.param("id")) || !repository.artifacts)
      return c.json({ error: "Artifacts unavailable" }, 409);
    try {
      const pack = await repository.artifacts(c.req.param("id"));
      return c.json({
        available: true,
        packDigest: pack.digest,
        sourceHash: pack.source.sha256,
        patch: pack.patch.content,
        reportChecks: pack.contract.expectations.length,
        upstreamAssertions: 50,
        independentCasesExported: 0,
      });
    } catch {
      return c.json(
        { error: "No complete verified selected repair is available." },
        409,
      );
    }
  });
  for (const kind of ["patch", "regression", "pack"] as const)
    app.get(`/api/repository-repairs/:id/${kind}`, async (c) => {
      if (active.has(c.req.param("id")))
        return c.json({ error: "Wait for completion before export" }, 409);
      if (!repository.artifacts)
        return c.json({ error: "Artifact backend unavailable" }, 409);
      try {
        const pack = await repository.artifacts(c.req.param("id"));
        const filename =
          kind === "patch"
            ? "repair.patch"
            : kind === "regression"
              ? "repolab-regression.mjs"
              : "repair-pack.json";
        c.header("Content-Disposition", `attachment; filename="${filename}"`);
        return kind === "pack"
          ? c.json(pack)
          : c.text(
              kind === "patch" ? pack.patch.content : pack.regression.content,
            );
      } catch {
        return c.json(
          {
            error:
              "A complete verified selected repair is required for patch, regression or pack export.",
          },
          409,
        );
      }
    });
  app.get("/api/repository-repairs/:id/replays", async (c) =>
    c.json((await repository.replays?.(c.req.param("id"))) ?? []),
  );
  app.get("/api/repository-replays/:id", async (c) => {
    const result = await repository.replayGet?.(c.req.param("id"));
    return result ? c.json(result) : c.json({ error: "Replay not found" }, 404);
  });
  app.post("/api/repository-repairs/:id/replay", async (c) => {
    if (active.size)
      return c.json({ error: "One workflow is already active." }, 409);
    if (!c.req.header("Content-Type")?.startsWith("application/json"))
      return c.json({ error: "Expected application/json" }, 415);
    if ((await c.req.text()).trim() !== "{}")
      return c.json(
        {
          error:
            "Replay accepts no source, command or configuration overrides.",
        },
        400,
      );
    const ready = repository.replayReady?.();
    if (!ready?.available || !repository.replay || !repository.artifacts)
      return c.json({ error: ready?.reason ?? "Replay unavailable" }, 409);
    try {
      await repository.artifacts(c.req.param("id"));
    } catch {
      return c.json({ error: "A verified selected repair is required." }, 409);
    }
    if (active.size)
      return c.json({ error: "One workflow is already active." }, 409);
    const id = randomUUID(),
      abort = new AbortController(),
      originId = c.req.param("id");
    active.set(id, abort);
    const task = Promise.resolve().then(() =>
      repository.replay!(id, originId, abort.signal),
    );
    tasks.set(id, task);
    void task
      .catch(() => console.error("Replay stopped; inspect retained evidence."))
      .finally(() => {
        active.delete(id);
        tasks.delete(id);
      });
    return c.json({ id }, 202);
  });
  app.post("/api/repository-replays/:id/cancel", (c) => {
    const abort = active.get(c.req.param("id"));
    if (!abort) return c.json({ error: "Replay is not active" }, 409);
    abort.abort();
    return c.json({ status: "cancellation-requested" }, 202);
  });
  app.post("/api/repository-repairs", async (c) => {
    if (active.size)
      return c.json(
        { error: "One run is already active. Wait or cancel it first." },
        409,
      );
    if (!c.req.header("Content-Type")?.startsWith("application/json"))
      return c.json({ error: "Expected application/json" }, 415);
    const text = await c.req.text();
    if (Buffer.byteLength(text) > 1024)
      return c.json({ error: "Repair request is too large" }, 413);
    try {
      RepairStartSchema.parse(JSON.parse(text));
    } catch {
      return c.json(
        {
          error:
            "Choose the fixed clsx development repair without configuration overrides.",
        },
        400,
      );
    }
    const readiness = repository.readiness();
    if (!readiness.available) return c.json({ error: readiness.reason }, 409);
    if (active.size)
      return c.json({ error: "One workflow is already active." }, 409);
    const id = randomUUID(),
      abort = new AbortController();
    active.set(id, abort);
    const task = Promise.resolve().then(() => repository.run(id, abort.signal));
    tasks.set(id, task);
    void task
      .catch(() => {
        console.error(
          "Repository repair stopped; inspect retained local evidence.",
        );
      })
      .finally(() => {
        active.delete(id);
        tasks.delete(id);
      });
    return c.json({ id }, 202);
  });
  app.post("/api/repository-repairs/:id/cancel", (c) => {
    const controller = active.get(c.req.param("id"));
    if (!controller) return c.json({ error: "Repair is not active" }, 409);
    controller.abort(new Error("User cancelled repair"));
    return c.json({ status: "cancellation-requested" }, 202);
  });
  app.get("/api/runs", (c) => c.json(store.list()));
  app.get("/api/runs/:id", (c) => {
    const run = store.get(c.req.param("id"));
    return run ? c.json(run) : c.json({ error: "Run not found" }, 404);
  });
  app.get("/api/runs/:id/pack", (c) => {
    const run = store.get(c.req.param("id"));
    if (!run) return c.json({ error: "Run not found" }, 404);
    if (active.has(run.id))
      return c.json(
        { error: "Wait for the run to finish before exporting evidence" },
        409,
      );
    c.header(
      "Content-Disposition",
      `attachment; filename="repolab-${run.id}.json"`,
    );
    return c.json(exportPack(run));
  });
  app.post("/api/runs", async (c) => {
    if (active.size)
      return c.json(
        { error: "One run is already active. Wait or cancel it first." },
        409,
      );
    if (!c.req.header("Content-Type")?.startsWith("application/json"))
      return c.json({ error: "Expected application/json" }, 415);
    const text = await c.req.text();
    if (Buffer.byteLength(text) > 16_000)
      return c.json({ error: "Report request is too large" }, 413);
    let input;
    try {
      input = IntakeSchema.parse(JSON.parse(text));
    } catch {
      return c.json(
        {
          error:
            "Choose a supported profile and provide a report of 20–8,000 characters.",
        },
        400,
      );
    }
    if (input.profile === "clsx-object-push")
      return c.json({ error: clsxExecutionBlocker }, 409);
    if (input.mode === "live" && !process.env.NEBIUS_API_KEY)
      return c.json(
        {
          error:
            "Set NEBIUS_API_KEY in the local .env file and restart the service before using live inference.",
        },
        409,
      );
    if (
      input.mode === "live" &&
      process.env.REPOLAB_EXECUTION === "nebius-sandbox" &&
      !isolatedReady()
    )
      return c.json(
        {
          error:
            "Run npm run smoke:sandbox successfully before enabling isolated repairs; the capability certificate may be missing, expired or from a different configuration.",
        },
        409,
      );
    if (active.size)
      return c.json({ error: "One workflow is already active." }, 409);
    const config = configFromEnv();
    const account = sha256(config.apiKey);
    const proposer =
      input.mode === "fixture"
        ? new FixtureProposer(input.profile)
        : new NebiusProposer({
            ...config,
            profile: input.profile,
            reserve: (amount) =>
              store.reserve(
                account,
                amount,
                Number(process.env.REPOLAB_DEVELOPMENT_BUDGET_USD ?? 4),
              ),
            settle: (id, amount) => store.settle(id, amount),
          });
    let run: Run;
    const executor: Executor =
      input.mode === "live" && isolatedReady()
        ? new NebiusSandboxExecutor({
            ...sandboxConfigFromEnv(),
            onOperation: (record) => {
              run.operations ??= [];
              const existing = run.operations.find((op) => op.id === record.id);
              if (existing) Object.assign(existing, record);
              else run.operations.push(record);
              store.save(run);
            },
          })
        : new TrustedFixtureExecutor();
    run = createRun(input, proposer, executor);
    const abort = new AbortController();
    active.set(run.id, abort);
    store.save(run);
    setImmediate(() => {
      const task = executeRun(run, proposer, executor, {
        signal: abort.signal,
        onUpdate: (update) => store.save(update),
      });
      tasks.set(run.id, task);
      void task
        .catch(() => {
          console.error("Run persistence failed; inspect local storage.");
        })
        .finally(() => {
          active.delete(run.id);
          tasks.delete(run.id);
        });
    });
    return c.json({ id: run.id }, 202);
  });
  app.post("/api/runs/:id/cancel", (c) => {
    const controller = active.get(c.req.param("id"));
    if (!controller) return c.json({ error: "Run is not active" }, 409);
    controller.abort(new Error("User cancelled run"));
    return c.json({ status: "cancellation-requested" }, 202);
  });
  app.onError((_error, c) =>
    c.json(
      { error: "Local service failed. Inspect storage and configuration." },
      500,
    ),
  );
  app.notFound((c) => c.json({ error: "Route not found" }, 404));
  return {
    app,
    active,
    close: async () => {
      for (const controller of active.values()) controller.abort();
      await Promise.allSettled(tasks.values());
    },
  };
}

export function recoverInterruptedRuns(store: Store) {
  const phases = new Set([
    "INTAKE",
    "PREPARING",
    "REPRODUCING",
    "CORE_FROZEN",
    "REPAIRING",
    "CHALLENGING",
    "VERIFYING",
    "PACKAGING",
  ]);
  for (const run of store.list())
    if (phases.has(run.status)) {
      run.status = "INCONCLUSIVE";
      run.updatedAt = new Date().toISOString();
      run.events.push({
        sequence: run.events.length + 1,
        at: run.updatedAt,
        status: "INCONCLUSIVE",
        message:
          "Local service restarted before this run completed. No automatic rerun occurred.",
      });
      store.save(run);
    }
}
