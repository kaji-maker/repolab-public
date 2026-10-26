import { readFileSync, realpathSync } from "node:fs";
import { resolve, basename } from "node:path";
import { z } from "zod";
import { sha256 } from "../evidence/hash.ts";
import { getBaselinePlan } from "./baseline.ts";
import { checkLiveBaseline } from "./live-baseline.ts";
import { checkQualificationExecution } from "./qualification.ts";
import {
  sandboxScope,
  readSandboxIsolation,
  sandboxReady,
} from "../execution/readiness.ts";
import type { SandboxConfig } from "../execution/nebius.ts";

/** Fixed-task service admission. It does not enable packs or generic executors. */
export function admitClsxPilot(snapshot: unknown, config: SandboxConfig) {
  const root = realpathSync(resolve(".repolab/repositories"));
  const read = (path: string) => {
    const full = realpathSync(resolve(path));
    if (
      !full.startsWith(root + "/") ||
      !/^clsx-[a-zA-Z0-9.-]+\.json$/.test(basename(full))
    )
      throw Error("Unexpected private preparation asset path");
    const bytes = readFileSync(full, "utf8");
    return { path: full, bytes, value: JSON.parse(bytes) };
  };
  readSandboxIsolation(config);
  if (!sandboxReady(config))
    throw Error("Refresh sandbox smoke before pilot admission");
  const raw = read(root + "/clsx-development-qualification.json");
  const { digest, ...payload } = raw.value;
  const plan = getBaselinePlan(snapshot);
  if (
    sha256(JSON.stringify(payload)) !== digest ||
    payload.format !== "repolab-development-case-qualification/v1" ||
    payload.status !== "DEVELOPMENT_PREPARATION_CHECKS_PASSED" ||
    payload.profile !== "clsx-object-push" ||
    payload.qualifiedForDevelopmentPreparation !== true ||
    payload.liveRepairAdmission !== false ||
    payload.snapshotDigest !== plan.snapshotDigest ||
    payload.scope !== sandboxScope(config) ||
    payload.dependencyImage !== config.image ||
    payload.inferenceCalls !== 0 ||
    payload.assets?.length !== 6 ||
    payload.operationIds?.length !== 11 ||
    new Set(payload.operationIds).size !== 11 ||
    payload.operationIds.some((id: unknown) => !z.uuid().safeParse(id).success)
  )
    throw Error(
      "Complete configuration-bound preparation certificate required",
    );
  const age = Date.now() - Date.parse(payload.verifiedAt);
  if (!Number.isFinite(age) || age < 0 || age >= 86400000)
    throw Error("Preparation certificate expired");
  const assets = payload.assets.map((a: { path: string; sha256: string }) => {
    const r = read(a.path);
    if (sha256(r.bytes) !== a.sha256)
      throw Error("Preparation asset bytes changed");
    return r;
  });
  if (
    new Set(assets.map((a: { path: string }) => a.path)).size !== 6 ||
    assets[0].path !== root + "/clsx-live-phase-execution.json" ||
    assets[1].path !== root + "/clsx-dependency-image.json"
  )
    throw Error("Preparation asset topology mismatch");
  const workflow = assets[0].value;
  if (
    workflow.steps?.length !== 4 ||
    workflow.steps.some(
      (s: { exitCode: number; output: string }, i: number) =>
        s.exitCode !== 0 ||
        resolve(JSON.parse(s.output).evidence) !== assets[i + 2].path,
    )
  )
    throw Error("Preparation sequence incomplete");
  const dependency = assets[1].value;
  if (
    dependency.image !== config.image ||
    dependency.scope !== sandboxScope(config) ||
    dependency.lockHash !== plan.lockHash ||
    dependency.runtimeVersion !== "v24.18.0" ||
    dependency.dependencyCount !== plan.dependencyCount ||
    !z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .safeParse(dependency.treeDigest).success
  )
    throw Error("Dependency image/lock binding mismatch");
  for (const [i, variant] of (["original", "reference"] as const).entries()) {
    const record = assets[i + 2].value;
    if (
      record.variant !== variant ||
      record.snapshotDigest !== plan.snapshotDigest ||
      record.dependencyImage !== config.image ||
      record.stage?.resultImage !== record.stagedImage ||
      record.execution?.image !== record.stagedImage ||
      !checkLiveBaseline(snapshot, variant, record.execution).passed
    )
      throw Error("Original/reference regression preparation invalid");
  }
  const checks = assets[4].value.checks;
  if (
    assets[4].value.snapshotDigest !== plan.snapshotDigest ||
    checks?.length !== 3
  )
    throw Error("Reproduction preparation incomplete");
  for (const [i, suite] of (
    ["baseline-controls", "reported-failure", "reported-failure"] as const
  ).entries())
    if (
      checks[i].suite !== suite ||
      checks[i].execution.image !== config.image ||
      !checkQualificationExecution(snapshot, suite, checks[i].execution).passed
    )
      throw Error("Reproduction preparation invalid");
  // These are the already-opened development qualification outcomes, never repair feedback.
  const evaluated = assets[5].value;
  if (
    evaluated.snapshotDigest !== plan.snapshotDigest ||
    evaluated.checks?.length !== 4 ||
    JSON.stringify(payload.developmentEvaluation) !==
      JSON.stringify([
        { variant: "original", passed: 9, total: 16 },
        { variant: "report-special-case", passed: 10, total: 16 },
        { variant: "boolean-push-only", passed: 13, total: 16 },
        { variant: "reference", passed: 16, total: 16 },
      ])
  )
    throw Error("Development evaluator qualification incomplete");
  return {
    certificateDigest: digest,
    certificatePath: raw.path,
    dependency,
    scope: sandboxScope(config),
    snapshotDigest: plan.snapshotDigest,
    admission: "dedicated-bounded-development-pilot" as const,
  };
}
