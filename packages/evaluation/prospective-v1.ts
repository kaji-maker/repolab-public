import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import { auditVueHardening } from "./vue-hardening-v1.ts";
import {
  REPAIR_FREEZE,
  freshAssets,
  freshBytes,
} from "../repositories/preact-repair-protocol-v3.ts";

export const PROSPECTIVE_FREEZE: string =
  "90eb431b3763c7a73f305fe5bf2b456d06c4f0d6b897770447ced2390b72d755";
export const SELECTION_FREEZE =
  "dd03bd39963f8b86f02ed91be63c6e30f8c24549bc3a7924156c24565ec74786";
export const prospectiveAssets = [
  "packages/evaluation/prospective-v1.ts",
  "apps/evaluator/prospective-v1.ts",
  "scripts/prospective-select-v1.py",
  "tests/prospective-v1.test.ts",
  "tests/prospective-selection-v1.py",
  "evaluation/PROSPECTIVE_SELECTION_V1.md",
  "evaluation/prospective-selection-v1.json",
  "evaluation/prospective-selection-freeze-v1.json",
  "evaluation/prospective-identities-v1.json",
  "evaluation/prospective-selected-v1.json",
  "evaluation/vue-hardening-v1.json",
  "evaluation/preact-product-repair-v3.json",
  "evaluation/external-selected-v1.json",
  ...freshAssets,
] as const;
export const prospectiveSettings = {
  format: "repolab-prospective-preparation/v1",
  selectionFreeze: SELECTION_FREEZE,
  phase: "SELECTION_AND_COMPARISON_PREPARED",
  selectedTasks: 8,
  repositoryOwners: 2,
  modelAdmission: false,
  executionAdmission: false,
  design: "shared-candidate-pool-paired-selector-comparison",
  model: "nvidia/nemotron-3-super-120b-a12b",
  thinking: "full",
  requestBytes: 64000,
  outputTokens: 16384,
  candidatesPerTask: 2,
  actualModelCallsPerTask: 2,
  maxActualModelCalls: 16,
  originalOperationsPerTask: 12,
  candidateOperationsPerCandidate: 15,
  independentOperationsPerTask: 8,
  fixtureQualificationOperations: 8,
  maxSandboxOperations: 408,
  monetaryCap: null,
  automaticProviderRetry: false,
  replaceFailedTask: false,
  generationFeedback:
    "none; both candidates generated before either selector executes",
  baselineSelection: "first candidate passing unchanged native suite once",
  repolabSelection:
    "first candidate passing static, module-load, protected native/public gates with two repeats",
  independentOpening:
    "only after both arm selections or abstentions are durably frozen",
  scope:
    "public dataset; prior software projection; training exposure unknown; two repository owners, no human independence claim",
} as const;
export const prospectiveHash = (b: string | Uint8Array) =>
  createHash("sha256").update(b).digest("hex");
export function prospectiveAssetBytes(path: string) {
  const b = readFileSync(path);
  return path === prospectiveAssets[0]
    ? Buffer.from(
        b.toString().replace(PROSPECTIVE_FREEZE, "__PROSPECTIVE_FREEZE__"),
      )
    : b;
}
const Identity = z
  .object({
    instance_id: z.string().regex(/^[A-Za-z0-9_.-]+__[A-Za-z0-9_.-]+-\d+$/),
    repo: z.enum(["preactjs/preact", "vuejs/core"]),
    base_commit: z.string().regex(/^[a-f0-9]{40}$/),
    version: z.string(),
    rank: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();
const Task = Identity.extend({
  problem_statement: z.string().min(1).max(64000),
  problemSha256: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();
export type ProspectiveTask = z.infer<typeof Task>;
function checkedDigest(raw: any) {
  const { digest, ...payload } = raw;
  if (digest !== prospectiveHash(JSON.stringify(payload)))
    throw Error("Prospective data digest changed");
  return payload;
}
/** Deterministic metadata-only rule; source difficulty/outcomes never enter selection. */
export function selectProspectiveIdentities(pool: unknown, policy: any) {
  if (!Array.isArray(pool)) throw Error("Identity pool required");
  if (
    !isDeepStrictEqual(policy.repositories, [
      "preactjs/preact",
      "vuejs/core",
    ]) ||
    policy.perRepository !== 4 ||
    policy.count !== 8 ||
    policy.seed !== "repolab-prospective-paired-v1/2026-10-16" ||
    policy.replacementAfterFailure !== false ||
    !isDeepStrictEqual(policy.excludedTaskIds, [
      "facebook__docusaurus-8927",
      "preactjs__preact-4436",
      "vuejs__core-11899",
    ])
  )
    throw Error("Prospective selection policy changed");
  const rows = pool.map((v) => Identity.parse(v)),
    seen = new Set<string>();
  for (const row of rows) {
    const repositoryId = row.repo.replace("/", "__");
    if (
      seen.has(row.instance_id) ||
      !row.instance_id.startsWith(repositoryId + "-") ||
      policy.excludedTaskIds.includes(row.instance_id) ||
      row.rank !== prospectiveHash(policy.seed + "\n" + row.instance_id)
    )
      throw Error("Invalid ranked identity");
    seen.add(row.instance_id);
  }
  const groups = policy.repositories.map((repo: string) =>
    rows
      .filter((r) => r.repo === repo)
      .sort(
        (a, b) =>
          a.rank.localeCompare(b.rank) ||
          a.instance_id.localeCompare(b.instance_id),
      ),
  );
  if (groups.some((g: unknown[]) => g.length < 4))
    throw Error("Insufficient tasks; no replacement");
  return Array.from({ length: 4 }, (_, i) =>
    groups.map((g: z.infer<typeof Identity>[]) => g[i]),
  ).flat();
}
export function auditProspective(reader = prospectiveAssetBytes) {
  if (PROSPECTIVE_FREEZE === "__UNFROZEN__")
    throw Error("Prospective preparation is not frozen");
  const manifest = JSON.parse(
    readFileSync("evaluation/prospective-v1.json", "utf8"),
  );
  const { digest, assets, ...settings } = manifest;
  if (
    digest !== PROSPECTIVE_FREEZE ||
    prospectiveHash(JSON.stringify({ ...settings, assets })) !== digest ||
    !isDeepStrictEqual(settings, prospectiveSettings) ||
    assets.length !== prospectiveAssets.length ||
    assets.some(
      (a: any, i: number) =>
        a.path !== prospectiveAssets[i] ||
        a.sha256 !== prospectiveHash(reader(a.path)),
    )
  )
    throw Error("Prospective preparation freeze changed");
  auditVueHardening();
  // Preparation binds the current product snapshot, not its expensive historical execution chain.
  // This never grants execution admission; a later live protocol must run its own full qualification.
  const preact = JSON.parse(
    reader("evaluation/preact-product-repair-v3.json").toString(),
  );
  if (
    preact.digest !== REPAIR_FREEZE ||
    checkedDigest(preact).assets.length !== freshAssets.length ||
    preact.assets.some(
      (a: any, i: number) =>
        a.path !== freshAssets[i] ||
        a.sha256 !== prospectiveHash(freshBytes(a.path)),
    )
  )
    throw Error("Current Preact configuration snapshot changed");
  const policy = JSON.parse(
    reader("evaluation/prospective-selection-v1.json").toString(),
  );
  const freeze = JSON.parse(
    reader("evaluation/prospective-selection-freeze-v1.json").toString(),
  );
  if (
    freeze.digest !== SELECTION_FREEZE ||
    checkedDigest(freeze).policySha256 !==
      prospectiveHash(JSON.stringify(policy)) ||
    freeze.projectorSha256 !==
      prospectiveHash(reader("scripts/prospective-select-v1.py")) ||
    freeze.designSha256 !==
      prospectiveHash(reader("evaluation/PROSPECTIVE_SELECTION_V1.md"))
  )
    throw Error("Selection authority changed");
  const identities = JSON.parse(
    reader("evaluation/prospective-identities-v1.json").toString(),
  );
  checkedDigest(identities);
  if (
    identities.selectionFreeze !== SELECTION_FREEZE ||
    identities.pool.length !== 20 ||
    !isDeepStrictEqual(
      identities.selected,
      selectProspectiveIdentities(identities.pool, policy),
    )
  )
    throw Error("Fixed cohort changed");
  const selected = JSON.parse(
    reader("evaluation/prospective-selected-v1.json").toString(),
  );
  checkedDigest(selected);
  if (
    selected.selectionFreeze !== SELECTION_FREEZE ||
    selected.datasetSha256 !== policy.datasetSha256 ||
    selected.identitiesDigest !== identities.digest ||
    selected.tasks.length !== 8
  )
    throw Error("Selected issue projection changed");
  const tasks = selected.tasks.map((t: unknown) => Task.parse(t));
  for (let i = 0; i < tasks.length; i++) {
    const { problem_statement, problemSha256, ...identity } = tasks[i];
    if (
      !isDeepStrictEqual(identity, identities.selected[i]) ||
      prospectiveHash(problem_statement) !== problemSha256
    )
      throw Error("Issue text or identity changed");
  }
  if (
    prospectiveSettings.maxActualModelCalls !==
      8 * prospectiveSettings.actualModelCallsPerTask ||
    prospectiveSettings.maxSandboxOperations !==
      8 *
        (prospectiveSettings.originalOperationsPerTask +
          2 * prospectiveSettings.candidateOperationsPerCandidate +
          prospectiveSettings.independentOperationsPerTask) +
        prospectiveSettings.fixtureQualificationOperations
  )
    throw Error("Paired resource accounting changed");
  return { manifest, tasks: tasks as ProspectiveTask[] };
}
export function readProspectiveTask(
  id: string,
  input?: unknown,
): ProspectiveTask {
  const original = auditProspective().tasks.find((t) => t.instance_id === id);
  if (!original) throw Error("Task outside fixed cohort");
  const task = Task.parse(input ?? original);
  if (!isDeepStrictEqual(task, original))
    throw Error("Task substitution rejected even with recomputed digest");
  return task;
}
/** Original issue only. No rank, private tests, arm state, reference patch or provider configuration. */
export function prospectiveOriginalContext(id: string) {
  const t = readProspectiveTask(id);
  return {
    repository: t.repo,
    baseCommit: t.base_commit,
    problemStatement: t.problem_statement,
  };
}
export function prospectivePreparationReport() {
  const { tasks } = auditProspective();
  return {
    format: "repolab-prospective-preparation-report/v1",
    freeze: PROSPECTIVE_FREEZE,
    selectionFreeze: SELECTION_FREEZE,
    phase: "PREPARED_NOT_EXECUTION_QUALIFIED",
    design: prospectiveSettings.design,
    counts: {
      selected: tasks.length,
      repositoryOwners: 2,
      perTaskNativeQualified: 0,
      executionReady: 0,
      modelAttempted: 0,
      setupFailed: 0,
      blockedPendingPreparation: 8,
    },
    tasks: tasks.map((t) => ({
      taskId: t.instance_id,
      repository: t.repo,
      commit: t.base_commit,
      title: t.problem_statement.split(/\r?\n/)[0],
      exposure:
        "public task; metadata/software projection disclosed; no prior ReproLab model attempt recorded",
      supportedRepositoryFamily: true,
      exactTaskNativeQualified: false,
      modelAdmission: false,
      executionAdmission: false,
      state: "BLOCKED_PENDING_PREPARATION",
      missing: [
        "PINNED_TASK_SOURCE_AND_MANIFEST",
        "EXACT_TASK_NATIVE_BASELINE_AND_REPRODUCTION",
        "CANDIDATE_CAPABLE_GUARDED_ADAPTER",
        "PUBLIC_AND_INDEPENDENT_CHECK_FREEZES",
        "GENERATOR_AND_BOTH_SELECTORS_EXECUTION_FREEZE",
      ],
    })),
    comparison: {
      baseline: "native suite once",
      repolab: "static + load + native/public twice",
      sameOrderedCandidates: true,
      independentCases: "unopened; freeze both selections first",
      selectedIncorrectUnderIndependentChecks: null,
      verified: null,
      accuracy: null,
    },
    resourceCeilings: {
      sharedModelCalls: 16,
      modelCallsPerTask: 2,
      maxSandboxOperations: 408,
      monetaryCap: null,
    },
    actualUsage: { modelCalls: 0, newSandboxOperations: 0 },
    inference: "none",
    execution:
      "offline pinned-data projection and historical parent audits only",
    previousFrameworkCohort: {
      selected: 3,
      nativeBaselineQualified: 2,
      newModelAttemptedThisPhase: 0,
      docusaurus: "unsupported retained",
    },
    nextTask: tasks[0].instance_id,
    limits: [
      "Selection/design freeze only; no live runner or accuracy claim",
      "Original adapters are task-specific, not qualification for a new commit",
      "Shared candidates compare selectors, not independently sampled end-to-end agents",
      "No human maintainer session or training-unseen claim",
    ],
  };
}
