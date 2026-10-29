import {
  readFile,
  writeFile,
  mkdir,
  rename,
  readdir,
  lstat,
} from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { z } from "zod";
import { existsSync } from "node:fs";
import { sha256 } from "../evidence/hash.ts";
import { auditEvaluationProtocol } from "../evaluation/protocol.ts";
import { getClsxEvaluationPlan } from "../evaluation/clsx.ts";
import { RepositorySandbox } from "../execution/repository-sandbox.ts";
import { sandboxConfigFromEnv } from "../execution/nebius.ts";
import type { SandboxConfig } from "../execution/nebius.ts";
import type { Execution, Gate } from "../contracts/index.ts";
import { readClsxPack, clsxSnapshot } from "./repair-artifacts.ts";
import { getClsxRepairPlan } from "./clsx-repair.ts";
import { getQualificationPlan } from "./qualification.ts";
import { compileOriginalControls } from "./original-controls.ts";
import {
  getCandidatePlan,
  checkCandidateStage,
  checkCandidateControls,
  checkCandidateBaseline,
  checkCandidateObservations,
} from "./candidate.ts";
import { admitClsxPilot } from "./admission.ts";
import { acquireRepairLease } from "./repair-lease.ts";
import { providerSecrets } from "./repair-view.ts";

export const replayActiveStatuses = new Set([
  "ADMITTING",
  "REPRODUCING",
  "VERIFYING",
  "EVALUATING",
]);
type Spec = Parameters<RepositorySandbox["run"]>[0];
export interface ReplayRecord {
  format: "repolab-clsx-replay/v1";
  id: string;
  originRunId?: string;
  packDigest?: string;
  sourceHash?: string;
  protocolDigest?: string;
  status: string;
  failedStage?: string;
  startedAt: string;
  completedAt?: string;
  success: boolean;
  provenance: {
    inference: "none (pack replay)";
    execution: "nebius-sandbox" | "simulated";
  };
  inferenceCalls: 0;
  estimatedInferenceUsd: 0;
  executionCount: number;
  gates: Gate[];
  executions: Execution[];
  operations: unknown[];
  evaluation?: { passed: number | null; total: number };
  reproduction?: unknown;
  error?: string;
  entrypoint: "cli" | "api";
  controllerPid: number;
}
interface ReplayOptions {
  id?: string;
  signal?: AbortSignal;
  evidenceDirectory?: string;
  entrypoint?: "cli" | "api";
  config?: SandboxConfig;
  // Reviewed test doubles only. Production API/CLI never accept these from a pack.
  admit?: () => ReturnType<typeof admitClsxPilot>;
  run?: (
    image: string,
    spec: Spec,
    signal: AbortSignal,
  ) => ReturnType<RepositorySandbox["run"]>;
}
export function replayReadiness() {
  try {
    if (existsSync(".repolab/repositories/clsx-repair.lock"))
      throw Error("Workflow lease is held");
    auditEvaluationProtocol();
    const config = sandboxConfigFromEnv();
    admitClsxPilot(clsxSnapshot(), config);
    return {
      available: true,
      reason: "Fresh isolated pack replay is ready; no inference calls.",
    };
  } catch {
    return {
      available: false,
      reason:
        "Refresh sandbox smoke and configuration-bound preparation before isolated replay.",
    };
  }
}
export async function replayClsxPack(
  input: unknown,
  options: ReplayOptions = {},
) {
  const directory = options.evidenceDirectory ?? ".repolab/repositories",
    id = z.uuid().parse(options.id ?? randomUUID());
  const path = join(directory, `clsx-replay-${id}.json`),
    signal = options.signal ?? new AbortController().signal;
  const record: ReplayRecord = {
    format: "repolab-clsx-replay/v1",
    id,
    status: "ADMITTING",
    startedAt: new Date().toISOString(),
    success: false,
    provenance: {
      inference: "none (pack replay)",
      execution: options.run ? "simulated" : "nebius-sandbox",
    },
    inferenceCalls: 0,
    estimatedInferenceUsd: 0,
    executionCount: 0,
    gates: [],
    executions: [],
    operations: [],
    entrypoint: options.entrypoint ?? "cli",
    controllerPid: process.pid,
  };
  const persist = async () => {
    const temp = path + "." + randomUUID();
    await writeFile(temp, JSON.stringify(record, null, 2) + "\n", {
      mode: 0o600,
      flag: "wx",
    });
    await rename(temp, path);
  };
  let release: (() => Promise<void>) | undefined;
  try {
    await mkdir(directory, { recursive: true, mode: 0o700 });
    await persist();
    signal.throwIfAborted();
    const pack = readClsxPack(input);
    record.packDigest = pack.digest;
    record.originRunId = pack.origin.runId;
    record.sourceHash = pack.source.sha256;
    record.protocolDigest = auditEvaluationProtocol().digest;
    release = await acquireRepairLease(directory, id);
    const config = options.config ?? sandboxConfigFromEnv(),
      snapshot = pack.original.snapshot;
    const admission = options.admit?.() ?? admitClsxPilot(snapshot, config);
    if (
      admission.dependency.treeDigest !== pack.dependency.treeDigest ||
      admission.dependency.lockHash !== pack.original.lockHash
    )
      throw Error("Current qualified dependency tree differs from pack");
    const run = async (image: string, spec: Spec) => {
      signal.throwIfAborted();
      if (++record.executionCount > 24)
        throw Error("Replay sandbox operation cap reached");
      await persist();
      const out = options.run
        ? await options.run(image, spec, signal)
        : await new RepositorySandbox({ ...config, image }, async (op) => {
            record.operations.push(structuredClone(op));
            await persist();
          }).run(spec, signal);
      record.executions.push(out.execution);
      await persist();
      return out;
    };
    const observe = async (
      source: string,
      tests: string,
      expected: Parameters<typeof checkCandidateObservations>[2],
    ) => {
      const out = await run(config.image, {
        phase: "observations",
        sourceHash: sha256(source),
        testHash: sha256(tests),
        files: [
          { path: "/tmp/repolab/src/index.js", content: source },
          { path: "/tmp/repolab/test.mjs", content: tests },
        ],
      });
      return checkCandidateObservations(
        source,
        tests,
        expected,
        out.execution,
        config.image,
      );
    };
    const requireGate = (gate: Gate) => {
      record.gates.push(gate);
      if (!gate.passed) throw Error("Replay gate failed");
    };
    const repair = getClsxRepairPlan(snapshot),
      qualification = getQualificationPlan(snapshot),
      controls = compileOriginalControls(snapshot);
    record.status = "REPRODUCING";
    await persist();
    const originalControls = await observe(
      repair.source,
      controls,
      qualification.baselineControls,
    );
    requireGate({
      name: "Original behavior controls",
      passed:
        originalControls.valid && originalControls.rows.every((r) => r.passed),
      detail: "Eight expectations from unchanged original tests",
    });
    const originals = [];
    for (let i = 0; i < 2; i++)
      originals.push(
        await observe(
          repair.source,
          pack.core.tests,
          pack.contract.expectations,
        ),
      );
    record.reproduction = originals;
    requireGate({
      name: "Fresh original failure twice",
      passed:
        originals.every((r) => r.valid && r.rows.some((p) => !p.passed)) &&
        JSON.stringify(originals[0].rows) === JSON.stringify(originals[1].rows),
      detail:
        "Controller compares original observations against sourced report expectations",
    });
    const source = pack.source.content,
      plan = getCandidatePlan(snapshot, source);
    const template = await readFile(
      "repositories/clsx-baseline/candidate-stage.mjs",
      "utf8",
    );
    const stage = template.replace(
      "/*REPOLAB_CANDIDATE_STAGE_CONFIG*/ null",
      JSON.stringify({
        treeDigest: admission.dependency.treeDigest,
        files: plan.files.map(({ path, sha256 }) => ({ path, sha256 })),
      }),
    );
    const fs = await readFile(
      "repositories/clsx-baseline/candidate-controls.mjs",
      "utf8",
    );
    record.status = "VERIFYING";
    await persist();
    const staged = await run(config.image, {
      phase: "candidate-stage",
      sourceHash: plan.sourceHash,
      testHash: sha256(stage),
      files: [
        ...plan.files.map((f) => ({
          path: "/tmp/repolab/upstream/" + f.path,
          content: f.content,
        })),
        { path: "/opt/repolab/candidate-stage.mjs", content: stage },
        { path: "/opt/repolab/candidate-runner.mjs", content: plan.runner },
        { path: "/opt/repolab/candidate-controls.mjs", content: fs },
      ],
    });
    requireGate(
      checkCandidateStage(
        plan,
        admission.dependency.treeDigest,
        staged.execution,
        config.image,
        sha256(stage),
        staged.resultImage,
      ),
    );
    const image = staged.resultImage!;
    const protectedCheck = await run(image, {
      phase: "candidate-controls",
      files: [],
      sourceHash: plan.sourceHash,
      testHash: sha256(fs),
    });
    requireGate(
      checkCandidateControls(
        source,
        protectedCheck.execution,
        image,
        sha256(fs),
      ),
    );
    const baseline = await run(image, {
      phase: "candidate-baseline",
      files: [],
      sourceHash: plan.sourceHash,
      testHash: plan.runnerHash,
    });
    requireGate(
      checkCandidateBaseline(snapshot, source, baseline.execution, image),
    );
    const core = await observe(
      source,
      pack.core.tests,
      pack.contract.expectations,
    );
    requireGate({
      name: "Sourced report regression",
      passed: core.valid && core.rows.every((r) => r.passed),
      detail: JSON.stringify(core.rows),
    });
    const preserved = await observe(
      source,
      controls,
      qualification.baselineControls,
    );
    requireGate({
      name: "Original behavioral controls",
      passed: preserved.valid && preserved.rows.every((r) => r.passed),
      detail: "Original expectations retained",
    });
    const fresh = await observe(
      source,
      pack.core.tests,
      pack.contract.expectations,
    );
    requireGate({
      name: "Fresh sourced regression",
      passed:
        fresh.valid &&
        fresh.rows.every((r) => r.passed) &&
        JSON.stringify(core.rows) === JSON.stringify(fresh.rows),
      detail: "Repeated in a distinct disposable sandbox",
    });
    const freshBaseline = await run(image, {
      phase: "candidate-baseline",
      files: [],
      sourceHash: plan.sourceHash,
      testHash: plan.runnerHash,
    });
    requireGate(
      checkCandidateBaseline(snapshot, source, freshBaseline.execution, image),
    );
    record.status = "EVALUATING";
    await persist();
    // Local frozen evaluator is never loaded from the downloaded pack and never used for inference.
    const evaluation = getClsxEvaluationPlan(snapshot);
    const checked = await observe(source, evaluation.tests, evaluation.cases);
    record.evaluation = {
      passed: checked.valid
        ? checked.rows.filter((r) => r.passed).length
        : null,
      total: evaluation.cases.length,
    };
    requireGate({
      name: "Exposed development evaluation",
      passed: checked.valid && checked.rows.every((r) => r.passed),
      detail: "16 local frozen development cases; not held-out accuracy",
    });
    requireGate({
      name: "Fresh execution identities",
      passed:
        new Set(record.executions.map((e) => e.operationId)).size === 11 &&
        new Set(record.executions.map((e) => e.id)).size === 11,
      detail: "Eleven distinct provider operations and execution records",
    });
    record.success = true;
    record.status = "VERIFIED_REPLAY_FOR_TESTED_SCENARIOS";
  } catch {
    record.failedStage = record.status;
    record.status = signal.aborted ? "CANCELLED" : "REPLAY_FAILED";
    record.error =
      "Replay stopped; prior gates, operations and failure remain recorded. No automatic retry.";
  } finally {
    record.completedAt = new Date().toISOString();
    await persist();
    await release?.();
  }
  return record;
}
export function replaySummary(
  record: ReplayRecord,
  secrets = providerSecrets(),
) {
  const view = {
    format: record.format,
    id: record.id,
    originRunId: record.originRunId,
    packDigest: record.packDigest,
    sourceHash: record.sourceHash,
    status: record.status,
    failedStage: record.failedStage,
    active: replayActiveStatuses.has(record.status),
    startedAt: record.startedAt,
    completedAt: record.completedAt,
    success: record.success,
    inferenceCalls: record.inferenceCalls,
    estimatedInferenceUsd: record.estimatedInferenceUsd,
    provenance: record.executions.length
      ? record.provenance
      : { inference: "none (pack replay)", execution: "none" },
    executionCount: record.executionCount,
    gates: record.gates,
    evaluation: record.evaluation,
    error: record.error,
    operations: record.executions.map((e) => ({
      id: e.id,
      operationId: e.operationId,
      runtimeVersion: e.runtimeVersion,
      sourceHash: e.sourceHash,
      testHash: e.testHash,
    })),
    scope:
      "Fresh replay of one selected development pack; not a new model repair",
  };
  const scrub = (v: any): any =>
    typeof v === "string"
      ? secrets.reduce((s, k) => (k ? s.replaceAll(k, "[redacted]") : s), v)
      : Array.isArray(v)
        ? v.map(scrub)
        : v && typeof v === "object"
          ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, scrub(x)]))
          : v;
  return scrub(view) as typeof view;
}
export type ReplayReview = ReturnType<typeof replaySummary>;
export class ReplayHistory {
  private directory: string;
  constructor(directory = ".repolab/repositories") {
    this.directory = directory;
  }
  async get(id: string) {
    try {
      const path = join(
          this.directory,
          `clsx-replay-${z.uuid().parse(id)}.json`,
        ),
        info = await lstat(path);
      if (!info.isFile() || info.isSymbolicLink() || info.size > 5000000)
        return null;
      const r = JSON.parse(await readFile(path, "utf8"));
      if (r.id !== id || r.format !== "repolab-clsx-replay/v1") return null;
      return replaySummary(r);
    } catch {
      return null;
    }
  }
  async list(originRunId: string) {
    let files: string[];
    try {
      files = await readdir(this.directory);
    } catch {
      return [];
    }
    const results = await Promise.all(
      files
        .filter((f) => /^clsx-replay-[0-9a-f-]{36}\.json$/.test(f))
        .map((f) => this.get(f.slice(12, -5))),
    );
    return results
      .filter((r): r is ReplayReview =>
        Boolean(r && r.originRunId === originRunId),
      )
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
      .slice(0, 30);
  }
  async recover() {
    let files: string[];
    try {
      files = await readdir(this.directory);
    } catch {
      return;
    }
    for (const file of files.filter((f) =>
      /^clsx-replay-[0-9a-f-]{36}\.json$/.test(f),
    )) {
      const id = file.slice(12, -5),
        review = await this.get(id);
      if (!review?.active) continue;
      const path = join(this.directory, file),
        record = JSON.parse(await readFile(path, "utf8"));
      if (
        record.entrypoint !== "api" ||
        !Number.isInteger(record.controllerPid)
      )
        continue;
      try {
        process.kill(record.controllerPid, 0);
        continue;
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== "ESRCH") continue;
      }
      record.failedStage = record.status;
      record.status = "INCONCLUSIVE";
      record.success = false;
      record.completedAt = new Date().toISOString();
      record.error =
        "Service restarted; no automatic replay. Operations and lease require explicit recovery.";
      const temp = path + "." + randomUUID();
      await writeFile(temp, JSON.stringify(record, null, 2) + "\n", {
        mode: 0o600,
        flag: "wx",
      });
      await rename(temp, path);
    }
  }
}
