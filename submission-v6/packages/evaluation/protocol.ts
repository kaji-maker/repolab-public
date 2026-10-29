import { readFileSync } from "node:fs";
import { z } from "zod";
import { sha256 } from "../evidence/hash.ts";

// Evaluation-only metadata. Never import this module into proposers or browser code.
export const evaluationV1AssetPaths = [
  "evaluation/booking-timezone/cases.json",
  "evaluation/checkout-quantity/cases.json",
  "evaluation/clsx-object-push/cases.json",
  "evaluation/clsx-object-push/check_expected.py",
  "fixtures/booking-timezone/profile.ts",
  "fixtures/checkout-quantity/profile.ts",
  "fixtures/clsx-upstream/original-snapshot.json",
  "packages/evaluation/booking.ts",
  "packages/evaluation/checkout.ts",
  "packages/evaluation/cases.ts",
  "packages/evaluation/clsx.ts",
  "packages/controller/observations.ts",
  "packages/controller/gates.ts",
  "packages/controller/tests.ts",
  "packages/controller/run.ts",
  "packages/providers/nebius.ts",
  "packages/providers/fixture.ts",
  "packages/repositories/qualification.ts",
  "packages/repositories/baseline.ts",
  "packages/repositories/clsx-contract.ts",
  "packages/repositories/clsx-repair.ts",
  "repositories/clsx-baseline/package-lock.json",
  "repositories/clsx-baseline/runner.mjs",
  "repositories/clsx-baseline/tree.json",
  "packages/execution/local.ts",
  "packages/execution/nebius.ts",
  "packages/execution/readiness.ts",
  "packages/contracts/index.ts",
  "packages/profiles/index.ts",
  "packages/evidence/hash.ts",
  "packages/evidence/pack.ts",
  "apps/evaluator/main.ts",
  "evaluation/PROTOCOL_V1.md",
  "docs/EVALUATION.md",
  "package-lock.json",
] as const;
export const evaluationV2AssetPaths = [
  ...evaluationV1AssetPaths,
  "evaluation/PROTOCOL_V2.md",
  "evaluation/archive/v1/nebius.ts.txt",
  "evaluation/archive/v1/readiness.ts.txt",
  "scripts/sandbox-controls.mjs",
] as const;
export const evaluationV3AssetPaths = [
  ...evaluationV2AssetPaths,
  "evaluation/PROTOCOL_V3.md",
  "packages/execution/repository-sandbox.ts",
  "packages/repositories/live-baseline.ts",
  "packages/repositories/candidate.ts",
  "packages/repositories/candidate-policy.ts",
  "packages/repositories/admission.ts",
  "packages/storage/store.ts",
  "apps/repositories/baseline.ts",
  "apps/repositories/repair.ts",
  "scripts/clsx-certify.mjs",
  "scripts/clsx-live-phase.mjs",
  "repositories/clsx-baseline/dependencies.mjs",
  "repositories/clsx-baseline/stage.mjs",
  "repositories/clsx-baseline/candidate-stage.mjs",
  "repositories/clsx-baseline/candidate-runner.mjs",
  "repositories/clsx-baseline/candidate-controls.mjs",
  "package.json",
  "tests/candidate.test.ts",
  "tests/live-baseline.test.ts",
] as const;
export const evaluationV4AssetPaths = [
  ...evaluationV3AssetPaths,
  "evaluation/PROTOCOL_V4.md",
  "evaluation/archive/v3/repair.ts.txt",
  "packages/repositories/original-controls.ts",
  "tests/original-controls.test.ts",
] as const;
export const evaluationV5AssetPaths = [
  ...evaluationV4AssetPaths,
  "evaluation/PROTOCOL_V5.md",
  "evaluation/archive/v3/store.ts.txt",
  "tests/ledger-key-rotation.test.ts",
  "evaluation/archive/v4/repair.ts.txt",
] as const;
export const evaluationV6AssetPaths = [
  ...evaluationV5AssetPaths,
  "evaluation/PROTOCOL_V6.md",
  "evaluation/archive/v5/providers-nebius.ts.txt",
  "evaluation/archive/v5/store.ts.txt",
  "evaluation/archive/v5/repair.ts.txt",
  "evaluation/archive/v5/package.json.txt",
  "packages/providers/diagnostics.ts",
  "packages/storage/reconciliation.ts",
  "apps/ledger/main.ts",
  "tests/provider-diagnostics.test.ts",
  "tests/reconciliation.test.ts",
  "tests/provider-budget.test.ts",
] as const;
export const evaluationV7AssetPaths = [
  ...evaluationV6AssetPaths,
  "evaluation/PROTOCOL_V7.md",
  "evaluation/archive/v6/providers-nebius.ts.txt",
  "evaluation/archive/v6/repair.ts.txt",
  "packages/providers/request-policy.ts",
  "tests/request-policy.test.ts",
] as const;
export const evaluationV8AssetPaths = [
  ...evaluationV7AssetPaths,
  "evaluation/PROTOCOL_V8.md",
  "evaluation/archive/v7/repair.ts.txt",
  "evaluation/archive/v7/store.ts.txt",
  "evaluation/archive/v7/admission.ts.txt",
  "packages/repositories/repair-service.ts",
  "packages/repositories/repair-readiness.ts",
  "packages/repositories/repair-view.ts",
  "packages/repositories/repair-history.ts",
  "packages/repositories/repair-lease.ts",
  "apps/api/app.ts",
  "apps/api/server.ts",
  "apps/web/src/RepositoryRepair.tsx",
  "apps/web/src/main.tsx",
  "apps/web/src/style.css",
  "tests/repository-api.test.ts",
  "scripts/repository-browser-smoke.mjs",
] as const;
export const evaluationAssetPaths = [
  ...evaluationV8AssetPaths,
  "evaluation/PROTOCOL_V9.md",
  "evaluation/archive/v8/repair-history.ts.txt",
  "evaluation/archive/v8/app.ts.txt",
  "evaluation/archive/v8/server.ts.txt",
  "evaluation/archive/v8/RepositoryRepair.tsx.txt",
  "evaluation/archive/v8/package.json.txt",
  "packages/repositories/repair-artifacts.ts",
  "packages/repositories/pack-replay.ts",
  "apps/repositories/replay.ts",
  "apps/web/src/RepairExports.tsx",
  "tests/repository-pack.test.ts",
  "tests/pack-replay.test.ts",
  "tests/pack-fixture.ts",
  "scripts/pack-browser-smoke.mjs",
] as const;
type AssetPath = (typeof evaluationAssetPaths)[number];
export type EvaluationAssetReader = (path: AssetPath) => string;
// V9 feature bytes remain immutable; portable-protocol.ts freezes the newer live assets.
const readAsset: EvaluationAssetReader = (path) => {
  const archived = [
    "apps/api/app.ts",
    "apps/api/server.ts",
    "apps/web/src/main.tsx",
  ].includes(path);
  return readFileSync(
    new URL(
      archived ? `../../evaluation/archive/v9/${path}.txt` : `../../${path}`,
      import.meta.url,
    ),
    "utf8",
  );
};

/** Explicit historical audit using exact retained bytes, never source execution. */
export function archivalEvaluationReader(
  version: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9,
): EvaluationAssetReader {
  if (version === 9) return readAsset;
  return (path) => {
    let archived: string | undefined;
    const v8Archives: Record<string, string> = {
      "packages/repositories/repair-history.ts": "repair-history.ts",
      "apps/api/app.ts": "app.ts",
      "apps/api/server.ts": "server.ts",
      "apps/web/src/RepositoryRepair.tsx": "RepositoryRepair.tsx",
    };
    if (v8Archives[path])
      archived = `evaluation/archive/v8/${v8Archives[path]}.txt`;
    if (path === "packages/repositories/admission.ts" && version <= 7)
      archived = "evaluation/archive/v7/admission.ts.txt";
    if (path === "packages/providers/nebius.ts" && version <= 6)
      archived = `evaluation/archive/v${version === 6 ? 6 : 5}/providers-nebius.ts.txt`;
    if (path === "packages/storage/store.ts")
      archived =
        version <= 4
          ? "evaluation/archive/v3/store.ts.txt"
          : version === 5
            ? "evaluation/archive/v5/store.ts.txt"
            : version <= 7
              ? "evaluation/archive/v7/store.ts.txt"
              : undefined;
    if (path === "apps/repositories/repair.ts" && version <= 7)
      archived = `evaluation/archive/v${version <= 3 ? 3 : version}/repair.ts.txt`;
    if (path === "package.json")
      archived =
        version <= 5
          ? "evaluation/archive/v5/package.json.txt"
          : "evaluation/archive/v8/package.json.txt";
    if (
      version === 1 &&
      (path === "packages/execution/nebius.ts" ||
        path === "packages/execution/readiness.ts")
    )
      archived = `evaluation/archive/v1/${path.split("/").at(-1)}.txt`;
    return archived
      ? readFileSync(new URL(`../../${archived}`, import.meta.url), "utf8")
      : readAsset(path);
  };
}
const Hash = z.string().regex(/^[a-f0-9]{64}$/);
const Task = z.strictObject({
  id: z.enum(["booking-timezone", "checkout-quantity", "clsx-object-push"]),
  group: z.enum(["constructed", "historical"]),
  split: z.literal("development"),
  evaluatorAssertions: z.number().int().min(1).max(50),
  reported: z.number().int().min(1),
  independent: z.number().int().min(0),
  baseline: z.number().int().min(0),
  repairEvidence: z.literal("LIVE_MODEL_REPAIR_UNMEASURED"),
});
const ProtocolPayload = z.strictObject({
  version: z.union([
    z.literal(1),
    z.literal(2),
    z.literal(3),
    z.literal(4),
    z.literal(5),
    z.literal(6),
    z.literal(7),
    z.literal(8),
    z.literal(9),
  ]),
  format: z.enum([
    "repolab-evaluation-protocol/v1",
    "repolab-evaluation-protocol/v2",
    "repolab-evaluation-protocol/v3",
    "repolab-evaluation-protocol/v4",
    "repolab-evaluation-protocol/v5",
    "repolab-evaluation-protocol/v6",
    "repolab-evaluation-protocol/v7",
    "repolab-evaluation-protocol/v8",
    "repolab-evaluation-protocol/v9",
  ]),
  frozenOn: z.enum(["2026-10-05", "2026-10-06", "2026-10-07"]),
  scope: z.literal("development-protocol-and-inventory"),
  revision: z
    .strictObject({
      previousDigest: z.enum([
        "3e0fd3dcfd97fa17c4dd1f0b9e1b58d07cd0fef56073737ec564f86d2d518e78",
        "037cb37b489473e5639da62baa9d7dd5126ad78f19cbefd32a7f022cbd209061",
        "f54a7830bbbff718f916a498fc1807a75ee1eba771183d00d8b8ba89f88262eb",
        "e0e6683392c48567365b403bc0d14ce705fa1b3039d23cf532d692ceb51a5e68",
        "a5230de24767da1d6868cca3619e96a94b1bb99939ebc6a7f2aa57970c5c0ba5",
        "8657b9bac808141b3e1c312302d495594213ca74af00789aadb5f1ea84afa68c",
        "cb2e9111fe34de36ffcd61093188229e153dd7adbb54bc8666405ed2e1fdab26",
        "5d69d2bdbdf0ce52ccae7d8675b5afe825e9a16238e140fc7af124d2d5c222f2",
      ]),
      reason: z.enum([
        "LIVE_SANDBOX_SENTINELS_AND_REQUIRED_ISOLATION_CONTROLS",
        "GUARDED_CLSX_DEVELOPMENT_PILOT",
        "ORIGINAL_CONTROLS_PROVENANCE_SERIALIZATION",
        "CREDENTIAL_ROTATION_CANNOT_BYPASS_UNCERTAIN_USAGE",
        "RECEIPT_BACKED_LEDGER_RECOVERY_AND_SAFE_PROVIDER_DIAGNOSTICS",
        "BOUNDED_NEMOTRON_LOW_EFFORT_REQUEST_POLICY",
        "SHARED_GUARDED_REPAIR_SERVICE_API_AND_WORKBENCH",
        "SCOPED_PATCH_REGRESSION_EXPORT_AND_ZERO_INFERENCE_ISOLATED_REPLAY",
      ]),
      studyDesignUnchanged: z.literal(true),
    })
    .optional(),
  tasks: z.array(Task).length(3),
  heldOutTasks: z.literal(0),
  negativeControls: z.literal(0),
  target: z.strictObject({
    constructed: z.strictObject({
      development: z.literal(4),
      heldOut: z.literal(4),
    }),
    historical: z.strictObject({
      development: z.literal(2),
      heldOut: z.literal(4),
    }),
    controls: z.strictObject({
      development: z.literal(0),
      heldOut: z.literal(2),
    }),
    totalTasks: z.literal(16),
    status: z.literal("UNFILLED_TARGET_REQUIRES_NEW_SELECTION_FREEZE"),
  }),
  comparison: z.strictObject({
    arms: z.tuple([
      z.strictObject({
        id: z.literal("A"),
        name: z.literal("direct-repair"),
        acceptance: z.literal("upstream"),
        implementation: z.literal("PENDING"),
      }),
      z.strictObject({
        id: z.literal("B"),
        name: z.literal("reproduction-plus-repair"),
        acceptance: z.literal("upstream-and-frozen-core"),
        implementation: z.literal("PENDING"),
      }),
      z.strictObject({
        id: z.literal("C"),
        name: z.literal("reprolab"),
        acceptance: z.literal(
          "upstream-core-challenges-integrity-fresh-verification",
        ),
        implementation: z.literal(
          "FIXTURE_CONTROLLER_ONLY_LIVE_CERTIFICATION_PENDING",
        ),
      }),
    ]),
    repetitions: z.literal(1),
    maxCandidates: z.literal(2),
    model: z.literal("nvidia/nemotron-3-super-120b-a12b"),
    parameters: z.union([
      z.strictObject({ max_tokens: z.literal(4096) }),
      z.strictObject({
        max_tokens: z.literal(4096),
        temperature: z.literal(1),
        top_p: z.literal(0.95),
        reasoning_effort: z.literal("low"),
        chat_template_kwargs: z.strictObject({
          enable_thinking: z.literal(true),
          low_effort: z.literal(true),
          force_nonempty_content: z.literal(true),
        }),
      }),
    ]),
    sampling: z.enum([
      "PROVIDER_DEFAULTS_NO_MATCHED_RANDOMNESS_CLAIM",
      "EXPLICIT_NEMOTRON_LOW_EFFORT_NO_MATCHED_RANDOMNESS_CLAIM",
    ]),
    maxInferenceCalls: z.literal(6),
    maxRequestBytes: z.literal(32000),
    runInferenceCapMicroUsd: z.literal(100000),
    evaluationAllocationMicroUsd: z.literal(8000000),
    ratesUsdPerMillion: z.strictObject({
      input: z.literal(0.3),
      output: z.literal(0.9),
      provenance: z.literal("CONFIGURED_ESTIMATES_NOT_INVOICED_COST"),
    }),
    execution: z.literal(
      "CERTIFIED_ISOLATION_REQUIRED_FOR_GENERATED_OR_UPSTREAM_SOURCE",
    ),
    sandboxBudget: z.literal(
      "UNMEASURED_REQUIRES_COVERAGE_AND_LIMITS_BEFORE_ADMISSION",
    ),
  }),
  scoring: z.strictObject({
    unit: z.literal("task-arm-repetition-workflow"),
    selection: z.literal(
      "FREEZE_SELECTED_SOURCE_AND_ARM_DECISION_BEFORE_INDEPENDENT_EVALUATION",
    ),
    success: z.literal(
      "INDEPENDENT_ASSERTIONS_AND_UNCHANGED_REGRESSION_PASS_WITH_COMPLETE_EVIDENCE",
    ),
    denominator: z.literal(
      "QUALIFIED_BUG_WORKFLOWS_ATTEMPTED_INCLUDING_ABSTENTIONS_AND_PROVIDER_ERRORS",
    ),
    allAttempted: z.literal(
      "ALSO_REPORT_SETUP_FAILURES_AND_UNQUALIFIED_PREPARATION_ATTEMPTS",
    ),
    zeroDenominator: z.literal("NULL_WITH_EXPLICIT_COUNTS_NEVER_ZERO_PERCENT"),
    fixtureResults: z.literal("SEPARATE_FROM_LIVE_NVIDIA_MODEL_REPAIRS"),
    groups: z.literal(
      "REPORT_CONSTRUCTED_HISTORICAL_AND_CONTROL_RESULTS_SEPARATELY",
    ),
    alreadyCorrect: z.literal("NO_ACCEPTED_PATCH_AND_JUSTIFIED_ABSTENTION"),
    missingFact: z.literal("NO_ACCEPTED_PATCH_AND_TARGETED_CLARIFICATION"),
    evidence: z.literal(
      "PIN_SOURCE_REPORT_TEST_EXPECTATION_LOCK_RUNTIME_IMAGE_OPERATION_USAGE_AND_PRE_EVALUATION_DECISION",
    ),
    retries: z.literal(
      "KEEP_ALL_CANDIDATES_FAILURES_CANCELLATIONS_AND_UNKNOWN_CHARGES_NO_SUCCESS_ONLY_RERUNS",
    ),
    holdOut: z.literal(
      "ALL_CURRENT_TASKS_DEVELOPMENT_NEW_HELD_OUT_SET_FROZEN_BEFORE_TUNING_AND_OPENING_LOGGED",
    ),
    feedback: z.literal(
      "WITHHELD_EXPECTATIONS_REFERENCE_AND_EVALUATOR_OUTPUT_NEVER_REPAIR_FEEDBACK",
    ),
  }),
  assets: z
    .array(z.strictObject({ path: z.enum(evaluationAssetPaths), sha256: Hash }))
    .min(evaluationV1AssetPaths.length)
    .max(evaluationAssetPaths.length),
});
const Protocol = ProtocolPayload.extend({ digest: Hash });
export type FrozenEvaluationProtocol = z.infer<typeof Protocol>;
export const frozenEvaluationV1Digest =
  "3e0fd3dcfd97fa17c4dd1f0b9e1b58d07cd0fef56073737ec564f86d2d518e78";
export const frozenEvaluationV2Digest =
  "037cb37b489473e5639da62baa9d7dd5126ad78f19cbefd32a7f022cbd209061";
export const frozenEvaluationV3Digest =
  "f54a7830bbbff718f916a498fc1807a75ee1eba771183d00d8b8ba89f88262eb";
export const frozenEvaluationV4Digest =
  "e0e6683392c48567365b403bc0d14ce705fa1b3039d23cf532d692ceb51a5e68";
export const frozenEvaluationV5Digest =
  "a5230de24767da1d6868cca3619e96a94b1bb99939ebc6a7f2aa57970c5c0ba5";
export const frozenEvaluationV6Digest =
  "8657b9bac808141b3e1c312302d495594213ca74af00789aadb5f1ea84afa68c";
export const frozenEvaluationV7Digest =
  "cb2e9111fe34de36ffcd61093188229e153dd7adbb54bc8666405ed2e1fdab26";
export const frozenEvaluationV8Digest =
  "5d69d2bdbdf0ce52ccae7d8675b5afe825e9a16238e140fc7af124d2d5c222f2";
export const frozenEvaluationDigest =
  "5a928ee3b46ee970cc533f1b1f2f7fa24a7e98cb8ff2713c8290120f4f6be3fe";

/** The three exposed development tasks; assertions never become independent bug tasks. */
function inventory(reader: EvaluationAssetReader) {
  return (
    ["booking-timezone", "checkout-quantity", "clsx-object-push"] as const
  ).map((id) => {
    const suite = z
      .object({
        split: z.literal("development"),
        cases: z
          .array(
            z.object({
              id: z.string(),
              origin: z.enum(["reported", "independent", "baseline"]),
            }),
          )
          .min(1)
          .max(50),
      })
      .parse(JSON.parse(reader(`evaluation/${id}/cases.json`)));
    if (new Set(suite.cases.map((row) => row.id)).size !== suite.cases.length)
      throw new Error(`Duplicate evaluator assertion IDs for ${id}`);
    return {
      id,
      group:
        id === "clsx-object-push"
          ? ("historical" as const)
          : ("constructed" as const),
      split: suite.split,
      evaluatorAssertions: suite.cases.length,
      reported: suite.cases.filter((row) => row.origin === "reported").length,
      independent: suite.cases.filter((row) => row.origin === "independent")
        .length,
      baseline: suite.cases.filter((row) => row.origin === "baseline").length,
      repairEvidence: "LIVE_MODEL_REPAIR_UNMEASURED" as const,
    };
  });
}

/** Offline audit only; accepting hashes establishes neither qualification nor correctness. */
export function auditEvaluationProtocol(
  input?: unknown,
  reader: EvaluationAssetReader = readAsset,
): FrozenEvaluationProtocol {
  const value =
    input ??
    JSON.parse(
      readFileSync(
        new URL("../../evaluation/protocol-v9.json", import.meta.url),
        "utf8",
      ),
    );
  const parsed = Protocol.parse(value);
  const { digest, ...payload } = parsed;
  if (
    sha256(JSON.stringify(payload)) !== digest ||
    digest !==
      (parsed.version === 1
        ? frozenEvaluationV1Digest
        : parsed.version === 2
          ? frozenEvaluationV2Digest
          : parsed.version === 3
            ? frozenEvaluationV3Digest
            : parsed.version === 4
              ? frozenEvaluationV4Digest
              : parsed.version === 5
                ? frozenEvaluationV5Digest
                : parsed.version === 6
                  ? frozenEvaluationV6Digest
                  : parsed.version === 7
                    ? frozenEvaluationV7Digest
                    : parsed.version === 8
                      ? frozenEvaluationV8Digest
                      : frozenEvaluationDigest) ||
    parsed.format !== `repolab-evaluation-protocol/v${parsed.version}` ||
    (parsed.version === 1
      ? parsed.revision !== undefined
      : parsed.revision === undefined)
  )
    throw new Error(
      "Evaluation protocol differs from the pinned freeze; use a new version for changes",
    );
  const expectedAssets =
    parsed.version === 1
      ? evaluationV1AssetPaths
      : parsed.version === 2
        ? evaluationV2AssetPaths
        : parsed.version === 3
          ? evaluationV3AssetPaths
          : parsed.version === 4
            ? evaluationV4AssetPaths
            : parsed.version === 5
              ? evaluationV5AssetPaths
              : parsed.version === 6
                ? evaluationV6AssetPaths
                : parsed.version === 7
                  ? evaluationV7AssetPaths
                  : parsed.version === 8
                    ? evaluationV8AssetPaths
                    : evaluationAssetPaths;
  if (
    parsed.assets.length !== expectedAssets.length ||
    new Set(parsed.assets.map((file) => file.path)).size !==
      expectedAssets.length ||
    expectedAssets.some(
      (path) => !parsed.assets.some((file) => file.path === path),
    )
  )
    throw new Error(
      "Evaluation freeze requires each reviewed asset exactly once",
    );
  for (const file of parsed.assets)
    if (sha256(reader(file.path)) !== file.sha256)
      throw new Error(`Frozen evaluation asset changed: ${file.path}`);
  if (JSON.stringify(inventory(reader)) !== JSON.stringify(parsed.tasks))
    throw new Error(
      "Evaluation task inventory differs from the frozen split/counts",
    );
  return parsed;
}

/** Data-only run sheet. It cannot admit, execute or score a workflow. */
export function evaluationRunSheet(
  protocol = auditEvaluationProtocol(),
  reader: EvaluationAssetReader = readAsset,
) {
  // Revalidate caller-supplied metadata; a recomputed checksum is not a new freeze.
  protocol = auditEvaluationProtocol(protocol, reader);
  const runs = protocol.tasks.flatMap((task) =>
    protocol.comparison.arms.map((arm) => ({
      id: `${task.id}/${arm.id}/1`,
      task: task.id,
      group: task.group,
      split: task.split,
      arm: arm.id,
      repetition: 1,
      status: "NOT_ATTEMPTED" as const,
      acceptance: arm.acceptance,
      maxCandidates: protocol.comparison.maxCandidates,
      blocker:
        arm.implementation === "PENDING"
          ? "COMPARISON_ARM_NOT_IMPLEMENTED"
          : "QUALIFICATION_AND_LIVE_EXECUTION_CERTIFICATION_REQUIRED",
    })),
  );
  return {
    format: "repolab-evaluation-runsheet/v1",
    protocolDigest: protocol.digest,
    status: "PLANNED_NOT_EXECUTED",
    runnable: false,
    tasks: protocol.tasks.length,
    evaluatorAssertions: protocol.tasks.reduce(
      (sum, task) => sum + task.evaluatorAssertions,
      0,
    ),
    heldOutTasks: protocol.heldOutTasks,
    negativeControls: protocol.negativeControls,
    repetitions: protocol.comparison.repetitions,
    plannedWorkflows: runs.length,
    attemptedWorkflows: 0,
    repairSuccess: { numerator: 0, denominator: 0, rate: null },
    inferenceUpperBoundUsd:
      (runs.length * protocol.comparison.runInferenceCapMicroUsd) / 1_000_000,
    allocationUsd: protocol.comparison.evaluationAllocationMicroUsd / 1_000_000,
    targetInferenceUpperBoundUsd:
      (protocol.target.totalTasks *
        protocol.comparison.arms.length *
        protocol.comparison.repetitions *
        protocol.comparison.runInferenceCapMicroUsd) /
      1_000_000,
    computeCost: null,
    affordability: "INFERENCE_CAPS_ONLY_COMPUTE_AND_COVERAGE_UNMEASURED",
    provenance: {
      inference: "none (offline protocol audit)",
      execution: "none (metadata read only)",
    },
    inferenceCalls: 0,
    executions: 0,
    runs,
  };
}
