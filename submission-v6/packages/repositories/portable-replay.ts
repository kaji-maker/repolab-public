import { randomUUID } from "node:crypto";
import {
  readFile,
  writeFile,
  rename,
  mkdir,
  lstat,
  readdir,
} from "node:fs/promises";
import { z } from "zod";
import { sha256 } from "../evidence/hash.ts";
import { commonTask } from "../evaluation/study-adapters-v6.ts";
import {
  createBoundGate,
  evaluateBoundGate,
  replayCommonGate,
} from "../evaluation/study-binding-v7.ts";
import type { StudyRemote } from "../evaluation/study-execution.ts";
import { studyRemote } from "../evaluation/study-execution.ts";
import { sandboxConfigFromEnv } from "../execution/nebius.ts";
import type { SandboxConfig } from "../execution/nebius.ts";
import {
  sandboxReady,
  readSandboxIsolation,
  sandboxScope,
} from "../execution/readiness.ts";
import { acquireRepairLease } from "./repair-lease.ts";
import { readPortablePack, selectedOrigins } from "./portable-pack.ts";
import { providerSecrets } from "./repair-view.ts";
import { auditPortableProtocol } from "./portable-protocol.ts";

export const portableRecipe = [
  {
    label: "Original upstream",
    original: true,
    suite: "baseline",
    expected: true,
  },
  {
    label: "Original report failure",
    original: true,
    suite: "core",
    expected: false,
  },
  {
    label: "Repeated original failure",
    original: true,
    suite: "core",
    expected: false,
  },
  {
    label: "Selected upstream",
    original: false,
    suite: "baseline",
    expected: true,
  },
  { label: "Selected report", original: false, suite: "core", expected: true },
  {
    label: "Public compatibility",
    original: false,
    suite: "challenge",
    expected: true,
  },
  {
    label: "Repeated selected report",
    original: false,
    suite: "core",
    expected: true,
  },
  {
    label: "Repeated selected upstream",
    original: false,
    suite: "baseline",
    expected: true,
  },
  {
    label: "Remaining independent evaluation",
    original: false,
    suite: "independent",
    expected: true,
  },
] as const;
export interface PortableReplayOptions {
  id?: string;
  signal?: AbortSignal;
  directory?: string;
  entrypoint?: "api" | "cli";
  config?: SandboxConfig;
  run?: StudyRemote;
  admit?: () => void;
}
export function portableReplayReadiness() {
  try {
    const cfg = sandboxConfigFromEnv();
    if (!cfg.coverageConfirmed || !sandboxReady(cfg)) throw Error();
    readSandboxIsolation(cfg);
    return {
      available: true,
      reason: "Fresh sandbox replay is ready; no inference required",
    };
  } catch {
    return {
      available: false,
      reason: "Refresh sandbox smoke and isolation controls before replay",
    };
  }
}
/** Verify raw gates, their ordering, immutable selection timing and fresh identities. */
export async function validatePortableReplay(
  record: any,
  allowSimulation = false,
) {
  const p = auditPortableProtocol(),
    pack = readPortablePack(record.pack),
    task = commonTask(pack.profile);
  if (
    record.protocolDigest !== p.digest ||
    record.packDigest !== pack.digest ||
    record.sourceHash !== pack.source.sha256 ||
    record.originRunId !== pack.origin.runId ||
    record.profile !== pack.profile ||
    record.inferenceCalls !== 0 ||
    record.estimatedInferenceUsd !== 0 ||
    record.provenance.inference !== "none (portable pack replay)" ||
    (!allowSimulation && record.provenance.execution !== "nebius-sandbox") ||
    !["nebius-sandbox", "simulation; source was not executed"].includes(
      record.provenance.execution,
    )
  )
    throw Error("Replay provenance or identity changed");
  if (
    record.gates.length !== portableRecipe.length ||
    record.executionCount !== portableRecipe.length
  )
    throw Error("Incomplete replay");
  const ids = new Set(),
    operations = new Set();
  for (const [i, step] of portableRecipe.entries()) {
    const gate = record.gates[i],
      source = step.original ? task.source : pack.source.content;
    if (gate.label !== step.label || gate.suite !== step.suite)
      throw Error("Replay sequence changed");
    await replayCommonGate(task, source, gate, { image: record.image });
    if (gate.result.passed !== step.expected)
      throw Error("Replay behavior failed");
    if (step.suite === "baseline") {
      if (
        gate.result.detail.assertionCount !==
          selectedOrigins[pack.profile].assertions ||
        gate.result.detail.filesystemDenials !== 9
      )
        throw Error("Original test integrity changed");
      for (const trace of gate.trace) {
        const body = JSON.parse(trace.execution.stdout);
        if (body.protectedInputs !== true || body.child?.exitCode !== 0)
          throw Error("Original input protection changed");
      }
    }
    for (const t of gate.trace) {
      if (ids.has(t.execution.id) || operations.has(t.execution.operationId))
        throw Error("Reused replay identity");
      ids.add(t.execution.id);
      operations.add(t.execution.operationId);
    }
  }
  if (
    ids.size !== 9 ||
    operations.size !== 9 ||
    JSON.stringify(record.gates[1].result.rows) !==
      JSON.stringify(record.gates[2].result.rows) ||
    JSON.stringify(record.gates[4].result.rows) !==
      JSON.stringify(record.gates[6].result.rows)
  )
    throw Error("Fresh repeat evidence changed");
  if (
    record.decision?.sourceHash !== pack.source.sha256 ||
    record.decision.packDigest !== pack.digest ||
    Date.parse(record.decision.at) > Date.parse(record.independentOpenedAt) ||
    Date.parse(record.independentOpenedAt) > Date.parse(record.completedAt)
  )
    throw Error("Replay decision chronology changed");
  return { passed: true, executionCount: ids.size };
}
export async function replayPortablePack(
  input: unknown,
  options: PortableReplayOptions = {},
) {
  const id = z.uuid().parse(options.id ?? randomUUID()),
    directory = options.directory ?? ".repolab/repositories",
    path = directory + "/portable-replay-" + id + ".json",
    signal = options.signal ?? new AbortController().signal;
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const dir = await lstat(directory);
  if (!dir.isDirectory() || dir.isSymbolicLink())
    throw Error("Invalid private evidence directory");
  const record: any = {
    format: "repolab-portable-replay/v1",
    id,
    status: "ADMITTING",
    startedAt: new Date().toISOString(),
    controllerPid: process.pid,
    success: false,
    entrypoint: options.entrypoint ?? "cli",
    inferenceCalls: 0,
    estimatedInferenceUsd: 0,
    executionCount: 0,
    gates: [],
    operations: [],
    provenance: {
      inference: "none (portable pack replay)",
      execution: options.run
        ? "simulation; source was not executed"
        : "nebius-sandbox",
    },
  };
  await writeFile(path, JSON.stringify(record, null, 2) + "\n", {
    flag: "wx",
    mode: 0o600,
  });
  const persist = async () => {
    const temp = path + "." + randomUUID();
    await writeFile(temp, JSON.stringify(record, null, 2) + "\n", {
      flag: "wx",
      mode: 0o600,
    });
    await rename(temp, path);
  };
  let release: (() => Promise<void>) | undefined;
  try {
    signal.throwIfAborted();
    record.protocolDigest = auditPortableProtocol().digest;
    const pack = readPortablePack(input),
      task = commonTask(pack.profile),
      cfg = options.config ?? sandboxConfigFromEnv();
    Object.assign(record, {
      pack,
      profile: pack.profile,
      packDigest: pack.digest,
      originRunId: pack.origin.runId,
      sourceHash: pack.source.sha256,
      image: cfg.image,
      scope: sandboxScope(cfg),
    });
    release = await acquireRepairLease(directory, id);
    if (options.run) {
      if (!options.admit) throw Error("Explicit simulation admission required");
      options.admit();
    } else {
      if (options.admit) throw Error("Live admission cannot be overridden");
      if (!cfg.coverageConfirmed || !sandboxReady(cfg))
        throw Error("Sandbox unavailable");
      readSandboxIsolation(cfg);
    }
    const raw =
      options.run ??
      studyRemote(cfg, async (op) => {
        record.operations.push(structuredClone(op));
        await persist();
      });
    const seenIds = new Set(),
      seenOperations = new Set();
    for (const [i, step] of portableRecipe.entries()) {
      signal.throwIfAborted();
      record.status = step.original
        ? "REPRODUCING"
        : step.suite === "independent"
          ? "EVALUATING"
          : "VERIFYING";
      if (i === 8) {
        record.decision = {
          at: new Date().toISOString(),
          packDigest: pack.digest,
          sourceHash: pack.source.sha256,
        };
        await persist();
        record.independentOpenedAt = new Date().toISOString();
      }
      const source = step.original ? task.source : pack.source.content,
        gate: any = {
          ...createBoundGate(task, source, step.suite),
          label: step.label,
        };
      record.gates.push(gate);
      await persist();
      gate.result = await evaluateBoundGate(
        task,
        source,
        step.suite,
        { image: cfg.image },
        async (image, spec) => {
          signal.throwIfAborted();
          if (++record.executionCount > 16)
            throw Error("Replay operation limit");
          await persist();
          const out = await raw(image, spec, signal);
          gate.trace.push({ image, spec, ...out });
          await persist();
          if (
            seenIds.has(out.execution.id) ||
            seenOperations.has(out.execution.operationId)
          )
            throw Error("Reused replay operation");
          seenIds.add(out.execution.id);
          seenOperations.add(out.execution.operationId);
          return out;
        },
      );
      await replayCommonGate(task, source, gate, { image: cfg.image });
      await persist();
      if (gate.result.passed !== step.expected)
        throw Error("Replay behavioral gate failed");
    }
    record.completedAt = new Date().toISOString();
    await validatePortableReplay(record, Boolean(options.run));
    record.success = true;
    record.status = "VERIFIED_REPLAY_FOR_TESTED_SCENARIOS";
  } catch {
    record.failedStage = record.status;
    record.status = signal.aborted ? "CANCELLED" : "REPLAY_FAILED";
    record.error =
      "Replay stopped; partial evidence retained. No automatic retry.";
  } finally {
    record.completedAt ??= new Date().toISOString();
    await persist();
    await release?.();
  }
  return record;
}
export async function portableReview(record: any) {
  let status = record.status,
    success = false;
  if (status === "VERIFIED_REPLAY_FOR_TESTED_SCENARIOS") {
    try {
      await validatePortableReplay(
        record,
        record.provenance?.execution === "simulation; source was not executed",
      );
      success = record.success === true;
      if (!success) throw Error();
    } catch {
      status = "INVALID_REPLAY_EVIDENCE";
    }
  }
  const scrub = (s: string) =>
    providerSecrets().reduce((v, k) => v.replaceAll(k, "[redacted]"), s);
  return {
    id: z.uuid().parse(record.id),
    profile: record.profile,
    originRunId: record.originRunId,
    packDigest: record.packDigest,
    sourceHash: record.sourceHash,
    status,
    success,
    startedAt: record.startedAt,
    completedAt: record.completedAt,
    executionCount: record.executionCount,
    provenance: {
      inference: "none (portable pack replay)",
      execution:
        record.provenance?.execution === "simulation; source was not executed"
          ? "simulation; source was not executed"
          : "nebius-sandbox",
    },
    gates: record.gates.map((g: any) => ({
      name: scrub(g.label ?? "Incomplete gate"),
      passed:
        status === "INVALID_REPLAY_EVIDENCE"
          ? null
          : (g.result?.passed ?? null),
      cases: g.result?.rows?.length ?? null,
      assertions: g.result?.detail?.assertionCount ?? null,
    })),
    error:
      status === "INVALID_REPLAY_EVIDENCE"
        ? "Saved replay evidence failed validation"
        : record.error
          ? "Replay stopped; partial evidence retained"
          : null,
  };
}
export type PortableReview = Awaited<ReturnType<typeof portableReview>>;
export class PortableHistory {
  directory: string;
  constructor(directory = ".repolab/repositories") {
    this.directory = directory;
  }
  async get(id: string): Promise<PortableReview | null> {
    try {
      const path =
          this.directory + "/portable-replay-" + z.uuid().parse(id) + ".json",
        info = await lstat(path);
      if (!info.isFile() || info.isSymbolicLink() || info.size > 16_777_216)
        return null;
      const r = JSON.parse(await readFile(path, "utf8"));
      if (r.format !== "repolab-portable-replay/v1" || r.id !== id) return null;
      return await portableReview(r);
    } catch {
      return null;
    }
  }
  async list(profile?: string) {
    let names: string[] = [];
    try {
      names = await readdir(this.directory);
    } catch {}
    const out: PortableReview[] = [];
    for (const name of names
      .filter((x) => /^portable-replay-[a-f0-9-]{36}\.json$/.test(x))
      .reverse()
      .slice(0, 100)) {
      const r = await this.get(name.slice(16, -5));
      if (r && (!profile || r.profile === profile)) out.push(r);
    }
    return out
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
      .slice(0, 30);
  }
  async recover() {
    let names: string[] = [];
    try {
      names = await readdir(this.directory);
    } catch {}
    for (const name of names.filter((x) =>
      /^portable-replay-[a-f0-9-]{36}\.json$/.test(x),
    )) {
      const path = this.directory + "/" + name,
        info = await lstat(path);
      if (!info.isFile() || info.isSymbolicLink() || info.size > 16_777_216)
        continue;
      const r = JSON.parse(await readFile(path, "utf8"));
      if (r.format !== "repolab-portable-replay/v1" || r.completedAt) continue;
      if (Number.isSafeInteger(r.controllerPid) && r.controllerPid > 0) {
        try {
          process.kill(r.controllerPid, 0);
          continue;
        } catch (e) {
          if ((e as NodeJS.ErrnoException).code !== "ESRCH") continue;
        }
      }
      r.status = "INTERRUPTED";
      r.success = false;
      r.completedAt = new Date().toISOString();
      r.error =
        "Controller stopped; inspect retained operations before explicit recovery. No automatic retry.";
      const temp = path + "." + randomUUID();
      await writeFile(temp, JSON.stringify(r, null, 2) + "\n", {
        flag: "wx",
        mode: 0o600,
      });
      await rename(temp, path);
    }
  }
}
