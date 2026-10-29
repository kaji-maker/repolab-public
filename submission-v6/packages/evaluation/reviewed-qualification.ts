import { mkdir, writeFile, rename } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { sandboxConfigFromEnv } from "../execution/nebius.ts";
import type { SandboxConfig } from "../execution/nebius.ts";
import {
  readSandboxIsolation,
  sandboxReady,
  sandboxScope,
} from "../execution/readiness.ts";
import { checkPilotExecution } from "./github-pilot-v2.ts";
import { studyRemote } from "./study-execution.ts";
import type { StudyRemote, StudyRunSpec } from "./study-execution.ts";
import type { Execution } from "../contracts/index.ts";

/** Internal reviewed adapters only; no CLI/API accepts an adapter, source or command override. */
export interface ReviewedQualificationAdapter {
  freeze(): { digest: string; task: string; maxOperations: number };
  format: string;
  schedule: readonly { variant: string; kind: string }[];
  spec(step: { variant: string; kind: string }): StudyRunSpec;
  validate(
    execution: Execution,
    step: { variant: string; kind: string },
    image: string,
  ): unknown;
  recompute(
    record: any,
    allowSimulation: boolean,
  ): { qualified: boolean; [key: string]: unknown };
}
export async function runReviewedQualification(
  adapter: ReviewedQualificationAdapter,
  options: {
    directory: string;
    config?: SandboxConfig;
    remote?: StudyRemote;
    signal?: AbortSignal;
  },
) {
  const p = adapter.freeze();
  if (adapter.schedule.length !== p.maxOperations)
    throw Error("Reviewed qualification schedule/cap mismatch");
  const config = options.config ?? sandboxConfigFromEnv(),
    signal = options.signal ?? new AbortController().signal;
  if (!options.remote) {
    readSandboxIsolation(config);
    if (!sandboxReady(config))
      throw Error("Current sandbox readiness required");
  }
  await mkdir(options.directory, { recursive: true, mode: 0o700 });
  const path = join(options.directory, "qualification.json");
  const record: any = {
    format: adapter.format,
    id: randomUUID(),
    studyDigest: p.digest,
    task: p.task,
    image: config.image,
    scope: sandboxScope(config),
    startedAt: new Date().toISOString(),
    status: "QUALIFYING",
    inferenceCalls: 0,
    modelRepairRun: false,
    operationAttempts: 0,
    qualified: false,
    checks: [],
    operations: [],
    provenance: {
      inference: "none",
      execution: options.remote ? "simulation" : "nebius-sandbox",
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
  const run =
    options.remote ??
    studyRemote(config, async (op) => {
      record.operations.push(structuredClone(op));
      await persist();
    });
  const seen = new Set<string>(),
    ids = new Set<string>();
  try {
    for (const step of adapter.schedule) {
      signal.throwIfAborted();
      if (record.operationAttempts >= p.maxOperations)
        throw Error("Qualification operation cap");
      const spec = adapter.spec(step);
      record.operationAttempts++;
      await persist();
      const e = (await run(config.image, spec, signal)).execution;
      record.checks.push({ ...step, execution: e });
      await persist();
      checkPilotExecution(e, spec, config.image);
      if (seen.has(e.operationId!) || ids.has(e.id))
        throw Error("Operation reused");
      seen.add(e.operationId!);
      ids.add(e.id);
      adapter.validate(e, step, config.image);
    }
    record.completedAt = new Date().toISOString();
    record.summary = adapter.recompute(record, !!options.remote);
    record.qualified = record.summary.qualified;
    record.status = record.qualified
      ? "QUALIFIED_FOR_FUTURE_STUDY"
      : "NOT_QUALIFIED";
  } catch {
    record.status = signal.aborted ? "CANCELLED" : "ERROR";
    record.error =
      "Qualification stopped; inspect retained execution evidence. No model repair or automatic retry.";
  } finally {
    record.completedAt = new Date().toISOString();
    await persist();
  }
  return { path, record };
}
