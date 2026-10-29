import type { Execution, Gate } from "../contracts/index.ts";
import { checkExecution } from "../controller/gates.ts";
import {
  compileObservationRunner,
  inspectObservations,
} from "../controller/observations.ts";
import { sha256 } from "../evidence/hash.ts";
import { readRepositorySnapshot } from "./prepare.ts";
import type { RepositorySnapshot } from "./prepare.ts";

export type QualificationSuite = "baseline-controls" | "reported-failure";
const reviewedFiles: Record<string, string> = {
  "src/index.js":
    "482ca5bb13abdc7edf91388dde3c419a91c04504e83c142ef082f36d2c0b386a",
  "test/index.js":
    "6e2021fcc414c7cd9fec62ec28acb2541c497e9f66e66f4b259ab0ee0e11265b",
  "test/classnames.js":
    "ba2cd2ccc4e057cc5e95167eec734b68805b90fa60b53fcf92e26d6ad92a99e6",
  "package.json":
    "4d1f637390b62560657059ea960c9dbd8ae4d69671ef7a2594a5fef1663426de",
  "readme.md":
    "d471bc929148beea98eb3ac44984431652759b4714eab7b1a52fe0283fe0f963",
  license: "9a9edad7baae52622bddf3c15b2ef8a33d2c89f2d25408ad13e8a7481c6b0c97",
};
const repository = "https://github.com/lukeed/clsx";
const commit = "af19571baaf00d73c8e7600cc0f0ede163b45bca";
const documentation = `${repository}/blob/${commit}/readme.md`;
export {
  reviewedFiles as clsxOriginalFileHashes,
  repository as clsxRepository,
  commit as clsxCommit,
};

// Authored from the pinned API documentation. These do not replace the upstream Tape suite.
const baselineControls = [
  { id: "empty", args: [], expected: "", source: documentation },
  { id: "string", args: ["hello"], expected: "hello", source: documentation },
  {
    id: "truthy-object-keys",
    args: [{ foo: true, bar: false, baz: 1 }],
    expected: "foo baz",
    source: documentation,
  },
  {
    id: "nested-arrays",
    args: ["foo", ["bar", ["", ["baz"]]]],
    expected: "foo bar baz",
    source: documentation,
  },
  {
    id: "falsy-values",
    args: [false, null, 0, "", "kept"],
    expected: "kept",
    source: documentation,
  },
  {
    id: "standalone-boolean",
    args: [true, "kept"],
    expected: "kept",
    source: documentation,
  },
  {
    id: "numeric-class",
    args: ["a", 1, "b"],
    expected: "a 1 b",
    source: `${repository}/blob/${commit}/test/classnames.js`,
  },
  {
    id: "falsy-push-key",
    args: ["stack", { pop: true, push: false }],
    expected: "stack pop",
    source: documentation,
  },
];
const reportedFailure = [
  {
    id: "truthy-push-key",
    args: ["stack", { pop: true, push: true }],
    expected: "stack pop push",
    observed: "stack",
    source: `${repository}/issues/17`,
    expectedBehaviorSource: documentation,
  },
];

export function getQualificationPlan(input: unknown) {
  const snapshot = readRepositorySnapshot(input);
  if (
    snapshot.manifest.id !== "clsx-object-push" ||
    snapshot.manifest.repository !== repository ||
    snapshot.manifest.commit !== commit ||
    snapshot.manifest.issueUrl !== `${repository}/issues/17` ||
    snapshot.files.length !== Object.keys(reviewedFiles).length ||
    !snapshot.files.every((file) => reviewedFiles[file.path] === file.sha256) ||
    snapshot.manifest.editablePaths.length !== 1 ||
    snapshot.manifest.editablePaths[0] !== "src/index.js"
  )
    throw new Error(
      "No reviewed qualification profile matches this repository snapshot",
    );
  return {
    profile: "clsx-object-push" as const,
    snapshotDigest: snapshot.digest,
    repository,
    commit,
    sourcePath: "src/index.js" as const,
    sourceHash: reviewedFiles["src/index.js"],
    source: snapshot.files.find((file) => file.path === "src/index.js")!
      .content,
    license: {
      spdx: snapshot.manifest.license.spdx,
      text: snapshot.files.find((file) => file.path === "license")!.content,
    },
    status: "PLANNED_NOT_EXECUTED" as const,
    scope: "selected-behavior-checks" as const,
    baselineControls: structuredClone(baselineControls),
    reportedFailure: structuredClone(reportedFailure),
    expectedExecutions: 3,
    remainingGates: [
      "Unchanged upstream build and regression suite",
      "Independently reviewed reference and evaluator",
      "NVIDIA-generated repair verification",
    ],
  };
}

/** Fixed harness, data-only assertions, one pinned module. No shell or dependency installation. */
export function compileQualificationTests(
  input: unknown,
  suite: QualificationSuite,
): string {
  getQualificationPlan(input);
  if (!["baseline-controls", "reported-failure"].includes(suite))
    throw new Error("Unknown qualification suite");
  const probes =
    suite === "baseline-controls" ? baselineControls : reportedFailure;
  return compileObservationRunner(
    "clsx",
    probes.map(({ id, args }) => ({ id, args })),
  );
}
export function checkQualificationExecution(
  input: unknown,
  suite: QualificationSuite,
  execution: Execution,
): Gate {
  const plan = getQualificationPlan(input);
  const tests = compileQualificationTests(input, suite);
  const probes =
    suite === "baseline-controls"
      ? plan.baselineControls
      : plan.reportedFailure;
  const gate = checkExecution(
    execution,
    probes,
    suite === "baseline-controls" ? "pass" : "reproduce",
    plan.sourceHash,
    sha256(tests),
  );
  if (!gate.passed) return gate;
  if (
    execution.provider !== "nebius-sandbox" ||
    !execution.operationId ||
    !execution.image ||
    !execution.runtimeVersion?.startsWith("v24.")
  )
    return {
      name: "Isolated repository provenance",
      passed: false,
      detail: "A complete Node 24 sandbox execution is required",
    };
  try {
    const body = inspectObservations(execution, probes);
    if (!body.valid) throw new Error("Invalid observations");
    for (const probe of probes) {
      const result = body.rows.find((r) => r.id === probe.id)!;
      if (
        result.expected !== probe.expected ||
        result.actual !==
          ("observed" in probe ? probe.observed : probe.expected)
      )
        throw new Error("Different behavior");
    }
  } catch {
    return {
      name: "Documented behavior matches",
      passed: false,
      detail:
        "Observed output or expected value differs from the reviewed case",
    };
  }
  return {
    name:
      suite === "baseline-controls"
        ? "Selected documented controls pass"
        : "Exact reported output reproduced",
    passed: true,
    detail: `${probes.length} reviewed assertions; upstream regression qualification remains separate`,
  };
}

export interface RepositoryProbeExecutor {
  executeRepositoryProbes(
    snapshot: RepositorySnapshot,
    suite: QualificationSuite,
    signal?: AbortSignal,
  ): Promise<Execution>;
}

/** An evidence checkpoint. It deliberately cannot issue a repair or full qualification verdict. */
export async function runRepositoryProbeQualification(
  input: unknown,
  executor: RepositoryProbeExecutor,
  options: {
    signal?: AbortSignal;
    onRecord?: (record: RepositoryProbeRecord) => void | Promise<void>;
  } = {},
): Promise<RepositoryProbeRecord> {
  const snapshot = readRepositorySnapshot(input);
  const plan = getQualificationPlan(snapshot);
  const record: RepositoryProbeRecord = {
    version: 1,
    profile: plan.profile,
    snapshotDigest: plan.snapshotDigest,
    sourceHash: plan.sourceHash,
    scope: plan.scope,
    startedAt: new Date().toISOString(),
    status: "IN_PROGRESS",
    qualified: false,
    inferenceCalls: 0,
    checks: [],
    remainingGates: plan.remainingGates,
  };
  const save = async () => {
    await options.onRecord?.(structuredClone(record));
  };
  try {
    await save();
    for (const suite of [
      "baseline-controls",
      "reported-failure",
      "reported-failure",
    ] as const) {
      options.signal?.throwIfAborted();
      const execution = await executor.executeRepositoryProbes(
        snapshot,
        suite,
        options.signal,
      );
      const gate = checkQualificationExecution(snapshot, suite, execution);
      const previous = record.checks.map((c) => c.execution);
      if (
        previous.some(
          (p) =>
            p.operationId === execution.operationId || p.id === execution.id,
        )
      ) {
        gate.passed = false;
        gate.detail =
          "Fresh qualification checks require distinct execution and operation IDs";
      }
      if (
        previous.some(
          (p) =>
            p.image !== execution.image ||
            p.runtimeVersion !== execution.runtimeVersion,
        )
      ) {
        gate.passed = false;
        gate.detail =
          "Qualification checks must use the same immutable image and runtime";
      }
      record.checks.push({
        suite,
        tests: compileQualificationTests(snapshot, suite),
        execution,
        gate,
      });
      await save();
      if (!gate.passed) {
        record.status = "BEHAVIOR_CHECK_FAILED";
        break;
      }
    }
    if (record.status === "IN_PROGRESS")
      record.status = "ORIGINAL_BEHAVIOR_CONFIRMED";
  } catch {
    record.status = options.signal?.aborted
      ? "CANCELLED"
      : "EXECUTION_UNAVAILABLE";
    record.error = options.signal?.aborted
      ? "Qualification cancelled; inspect recorded sandbox operations"
      : "Qualification could not complete; inspect recorded sandbox operations";
  }
  record.finishedAt = new Date().toISOString();
  await save();
  return record;
}

export interface RepositoryProbeRecord {
  version: 1;
  profile: string;
  snapshotDigest: string;
  sourceHash: string;
  scope: "selected-behavior-checks";
  startedAt: string;
  finishedAt?: string;
  status:
    | "IN_PROGRESS"
    | "ORIGINAL_BEHAVIOR_CONFIRMED"
    | "BEHAVIOR_CHECK_FAILED"
    | "EXECUTION_UNAVAILABLE"
    | "CANCELLED";
  qualified: false;
  inferenceCalls: 0;
  remainingGates: string[];
  error?: string;
  checks: {
    suite: QualificationSuite;
    tests: string;
    execution: Execution;
    gate: Gate;
  }[];
}
