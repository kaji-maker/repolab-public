import { readFileSync } from "node:fs";
import { z } from "zod";
import {
  compileObservationRunner,
  inspectObservations,
} from "../controller/observations.ts";
import type { Execution } from "../contracts/index.ts";
import { sha256 } from "../evidence/hash.ts";
import { getQualificationPlan } from "../repositories/qualification.ts";
import { readRepositorySnapshot } from "../repositories/prepare.ts";
import type { RepositorySnapshot } from "../repositories/prepare.ts";

export const clsxVariants = [
  "original",
  "report-special-case",
  "boolean-push-only",
  "reference",
] as const;
export type ClsxVariant = (typeof clsxVariants)[number];
const caseFileHash =
  "74f4768370b05c1f7f049f9e25548a31fd7792b5d9b00040d1f8acf04b45f9f7";
type JsonValue =
  null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
interface ClsxCase {
  id: string;
  origin: "reported" | "independent";
  args: JsonValue[];
  expected: string;
}

/** Evaluator-only material. Do not import into model adapters or browser code. */
export function getClsxEvaluationPlan(input: unknown) {
  const profile = getQualificationPlan(input);
  const data = readFileSync(
    new URL("../../evaluation/clsx-object-push/cases.json", import.meta.url),
    "utf8",
  );
  if (sha256(data) !== caseFileHash)
    throw new Error("Frozen clsx evaluation cases changed");
  const cases = (JSON.parse(data) as { cases: ClsxCase[] }).cases;
  const marker = "!!mix.push";
  if (profile.source.split(marker).length !== 2)
    throw new Error("Unexpected original source");
  const sources: Record<ClsxVariant, string> = {
    original: profile.source,
    "report-special-case": profile.source.replace(
      "export default function () {",
      `export default function () {\n\tif (JSON.stringify(Array.from(arguments)) === ${JSON.stringify(JSON.stringify(cases[0].args))}) return 'stack pop push';`,
    ),
    "boolean-push-only": profile.source.replace(
      marker,
      "!!mix.push && mix.push !== true",
    ),
    reference: profile.source.replace(marker, "Array.isArray(mix)"),
  };
  const tests = compileClsxEvaluationCases(cases);
  return {
    version: 1 as const,
    profile: profile.profile,
    snapshotDigest: profile.snapshotDigest,
    repository: profile.repository,
    commit: profile.commit,
    split: "development" as const,
    scope: "selected-behavior-evaluation" as const,
    status: "PLANNED_NOT_EXECUTED" as const,
    qualified: false as const,
    caseFileHash,
    cases,
    documentation: `${profile.repository}/blob/${profile.commit}/readme.md`,
    upstreamControls: `${profile.repository}/blob/${profile.commit}/test/classnames.js`,
    issue: `${profile.repository}/issues/17`,
    sourcePath: profile.sourcePath,
    tests,
    testHash: sha256(tests),
    variants: clsxVariants.map((id) => ({
      id,
      source: sources[id],
      sourceHash: sha256(sources[id]),
    })),
    license: profile.license,
    inferenceCalls: 0,
    expectedExecutions: clsxVariants.length,
    limitation:
      "16 authored assertions for one historical development bug; no held-out tasks, upstream regression qualification or model repair results",
    remainingGates: [
      "Isolated reference and weak-patch evaluation",
      "Unchanged upstream build and regression suite",
      "NVIDIA-generated repair verification",
    ],
  };
}

function compileClsxEvaluationCases(cases: ClsxCase[]): string {
  return compileObservationRunner(
    "clsx",
    cases.map(({ id, args }) => ({ id, args })),
  );
}

export function getClsxEvaluationVariant(input: unknown, variant: ClsxVariant) {
  const plan = getClsxEvaluationPlan(input);
  const selected = plan.variants.find((item) => item.id === variant);
  if (!selected) throw new Error("Unknown clsx evaluation variant");
  return {
    ...selected,
    sourcePath: plan.sourcePath,
    tests: plan.tests,
    testHash: plan.testHash,
  };
}

export interface ClsxEvaluationResult {
  variant: ClsxVariant;
  valid: boolean;
  total: number;
  passed: number | null;
  assertionFailures: number | null;
  rows: {
    caseId: string;
    origin: ClsxCase["origin"];
    actual: string;
    expected: string;
    passed: boolean;
  }[];
  error?: string;
}

/** Checks immutable evaluator expectations as well as runtime/assertion consistency. */
export function inspectClsxEvaluation(
  input: unknown,
  variant: ClsxVariant,
  execution: Execution,
): ClsxEvaluationResult {
  const plan = getClsxEvaluationPlan(input);
  const selected = getClsxEvaluationVariant(input, variant);
  const invalid = (): ClsxEvaluationResult => ({
    variant,
    valid: false,
    total: plan.cases.length,
    passed: null,
    assertionFailures: null,
    rows: [],
    error: "Incomplete or inconsistent isolated evaluation evidence",
  });
  if (
    execution.provider !== "nebius-sandbox" ||
    !z.uuid().safeParse(execution.id).success ||
    !z.uuid().safeParse(execution.operationId).success ||
    !z.uuid().safeParse(execution.image).success ||
    execution.sourceHash !== selected.sourceHash ||
    execution.testHash !== plan.testHash ||
    execution.timedOut !== false ||
    execution.truncated !== false ||
    execution.signal !== null ||
    ![0, 1].includes(execution.exitCode ?? -1) ||
    Buffer.byteLength(execution.stdout) > 16_384
  )
    return invalid();
  try {
    const body = inspectObservations(execution, plan.cases);
    if (!body.valid) return invalid();
    const rows = plan.cases.map((item) => {
      const result = body.rows.find((row) => row.id === item.id)!;
      return {
        caseId: item.id,
        origin: item.origin,
        actual: String(result.actual),
        expected: item.expected,
        passed: result.passed,
      };
    });
    const passed = rows.filter((row) => row.passed).length;
    return {
      variant,
      valid: true,
      total: rows.length,
      passed,
      assertionFailures: rows.length - passed,
      rows,
    };
  } catch {
    return invalid();
  }
}

export interface ClsxEvaluationExecutor {
  executeRepositoryEvaluation(
    snapshot: RepositorySnapshot,
    variant: ClsxVariant,
    signal?: AbortSignal,
  ): Promise<Execution>;
}
export interface ClsxEvaluationRecord {
  version: 1;
  profile: "clsx-object-push";
  snapshotDigest: string;
  caseFileHash: string;
  testHash: string;
  split: "development";
  scope: "selected-behavior-evaluation";
  status:
    | "IN_PROGRESS"
    | "DEVELOPMENT_CHECKS_PASSED"
    | "DEVELOPMENT_CHECKS_FAILED"
    | "EXECUTION_UNAVAILABLE"
    | "CANCELLED";
  qualified: false;
  inferenceCalls: 0;
  startedAt: string;
  finishedAt?: string;
  checks: {
    variant: ClsxVariant;
    execution: Execution;
    result: ClsxEvaluationResult;
    mechanismGatePassed: boolean;
  }[];
  remainingGates: string[];
  error?: string;
}

export async function runClsxEvaluation(
  input: unknown,
  executor: ClsxEvaluationExecutor,
  options: {
    signal?: AbortSignal;
    onRecord?: (record: ClsxEvaluationRecord) => void | Promise<void>;
  } = {},
): Promise<ClsxEvaluationRecord> {
  const snapshot = readRepositorySnapshot(input);
  const plan = getClsxEvaluationPlan(snapshot);
  const record: ClsxEvaluationRecord = {
    version: 1,
    profile: plan.profile,
    snapshotDigest: plan.snapshotDigest,
    caseFileHash: plan.caseFileHash,
    testHash: plan.testHash,
    split: plan.split,
    scope: plan.scope,
    status: "IN_PROGRESS",
    qualified: false,
    inferenceCalls: 0,
    startedAt: new Date().toISOString(),
    checks: [],
    remainingGates: plan.remainingGates,
  };
  const save = async () => {
    await options.onRecord?.(structuredClone(record));
  };
  try {
    await save();
    for (const variant of clsxVariants) {
      options.signal?.throwIfAborted();
      const execution = await executor.executeRepositoryEvaluation(
        snapshot,
        variant,
        options.signal,
      );
      const result = inspectClsxEvaluation(snapshot, variant, execution);
      if (
        record.checks.some(
          (previous) =>
            previous.execution.id === execution.id ||
            previous.execution.operationId === execution.operationId ||
            previous.execution.image !== execution.image ||
            previous.execution.runtimeVersion !== execution.runtimeVersion,
        )
      ) {
        result.valid = false;
        result.passed = result.assertionFailures = null;
        result.rows = [];
        result.error =
          "Development comparisons require fresh operations in the same image/runtime";
      }
      const reported = result.rows.find((row) => row.origin === "reported");
      const mechanismGatePassed =
        result.valid &&
        (variant === "original"
          ? reported?.actual === "stack" && reported.passed === false
          : variant === "reference"
            ? result.passed === result.total
            : reported?.passed === true &&
              result.rows.some(
                (row) => row.origin === "independent" && !row.passed,
              ));
      record.checks.push({ variant, execution, result, mechanismGatePassed });
      await save();
      if (!mechanismGatePassed) {
        record.status = "DEVELOPMENT_CHECKS_FAILED";
        break;
      }
    }
    if (record.status === "IN_PROGRESS") {
      record.status = options.signal?.aborted
        ? "CANCELLED"
        : "DEVELOPMENT_CHECKS_PASSED";
      if (record.status === "DEVELOPMENT_CHECKS_PASSED")
        record.remainingGates = record.remainingGates.filter(
          (gate) => gate !== "Isolated reference and weak-patch evaluation",
        );
    }
  } catch {
    record.status = options.signal?.aborted
      ? "CANCELLED"
      : "EXECUTION_UNAVAILABLE";
    record.error =
      "Evaluation interrupted; inspect saved sandbox operations before retrying";
  }
  record.finishedAt = new Date().toISOString();
  await save();
  return record;
}
