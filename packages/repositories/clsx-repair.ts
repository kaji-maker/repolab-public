import { z } from "zod";
import {
  ClsxContractSchema,
  IntakeSchema,
  PatchSchema,
} from "../contracts/index.ts";
import type { Proposer, RepositoryRepairContext } from "../contracts/index.ts";
import { compileTests } from "../controller/tests.ts";
import { sha256 } from "../evidence/hash.ts";
import { groundContract } from "../providers/fixture.ts";
import { getBaselinePlan } from "./baseline.ts";
import {
  clsxExampleReport,
  clsxExecutionBlocker,
  clsxClarification,
  extractClsxContract,
} from "./clsx-contract.ts";
import { readRepositorySnapshot } from "./prepare.ts";
import {
  clsxOriginalFileHashes,
  clsxRepository,
  clsxCommit,
  getQualificationPlan,
} from "./qualification.ts";

const contextPaths = [
  "package.json",
  "readme.md",
  "test/classnames.js",
  "test/index.js",
] as const;
const RepositoryContext = z.strictObject({
  repository: z.literal(clsxRepository),
  commit: z.literal(clsxCommit),
  files: z
    .array(
      z.strictObject({
        path: z.enum(contextPaths),
        content: z.string().max(4000),
        sha256: z.string().regex(/^[a-f0-9]{64}$/),
      }),
    )
    .length(contextPaths.length),
});

/** Only pinned original documentation and tests. No evaluator or reference implementation. */
export function validateClsxContext(input: unknown): RepositoryRepairContext {
  const context = RepositoryContext.parse(input);
  if (
    new Set(context.files.map((file) => file.path)).size !==
      contextPaths.length ||
    context.files.some(
      (file) =>
        sha256(file.content) !== file.sha256 ||
        clsxOriginalFileHashes[file.path] !== file.sha256,
    )
  )
    throw new Error(
      "Repair context differs from the pinned original repository",
    );
  context.files.sort((a, b) => a.path.localeCompare(b.path));
  return context;
}

export function validateClsxRepairContext(
  input: Parameters<Proposer["repair"]>[0],
) {
  const schema = z.strictObject({
    source: z.string().max(16_000),
    contract: ClsxContractSchema,
    tests: z.string().max(16_000),
    failure: z.string().min(1).max(4000),
    attempt: z.number().int().min(1).max(2),
    previous: PatchSchema.shape.content.optional(),
    repository: RepositoryContext,
  });
  const context = schema.parse(input);
  context.repository = validateClsxContext(context.repository) as z.infer<
    typeof RepositoryContext
  >;
  if (sha256(context.source) !== clsxOriginalFileHashes["src/index.js"])
    throw new Error("Repair must retain the pinned original source");
  const report = context.contract.expectations
    .map((probe) => probe.sourceQuote)
    .join("\n");
  context.contract = ClsxContractSchema.parse(
    groundContract(report, context.contract, "clsx-object-push"),
  );
  if (
    compileTests(
      context.contract.expectations.map(
        ({ sourceQuote: _, ...probe }) => probe,
      ),
    ) !== context.tests
  )
    throw new Error("Repair harness differs from the frozen report inputs");
  if (
    (context.attempt === 1 && context.previous !== undefined) ||
    (context.attempt === 2 && !context.previous)
  )
    throw new Error(
      "Second repair requires the prior candidate; first repair must omit it",
    );
  return context;
}

/** An offline preparation artifact, never a run or qualification certificate. */
export function getClsxRepairPlan(input: unknown, report = clsxExampleReport) {
  const snapshot = readRepositorySnapshot(input);
  const qualification = getQualificationPlan(snapshot);
  const baseline = getBaselinePlan(snapshot);
  const intake = IntakeSchema.parse({
    profile: "clsx-object-push",
    mode: "live",
    report,
  });
  const contract = extractClsxContract(intake.report);
  const repository = validateClsxContext({
    repository: qualification.repository,
    commit: qualification.commit,
    files: snapshot.files
      .filter((file) => (contextPaths as readonly string[]).includes(file.path))
      .map(({ path, content, sha256 }) => ({ path, content, sha256 })),
  });
  const runner = contract
    ? compileTests(
        contract.expectations.map(({ sourceQuote: _, ...probe }) => probe),
      )
    : null;
  const preparation = {
    format: "repolab-repair-preparation/v1" as const,
    profile: intake.profile,
    status: contract
      ? ("WAITING_FOR_QUALIFICATION" as const)
      : ("NEEDS_CLARIFICATION" as const),
    qualified: false,
    runnable: false,
    reason: clsxExecutionBlocker,
    clarification: contract ? null : clsxClarification,
    snapshotDigest: snapshot.digest,
    sourcePath: qualification.sourcePath,
    sourceHash: qualification.sourceHash,
    source: qualification.source,
    report: intake.report,
    reportHash: sha256(intake.report),
    contract,
    expectationsHash: contract
      ? sha256(JSON.stringify(contract.expectations))
      : null,
    runner,
    runnerHash: runner ? sha256(runner) : null,
    repository,
    modelContextHash: sha256(JSON.stringify(repository)),
    baselineRecipeDigest: baseline.recipeDigest,
    maxCandidates: 2,
    inferenceCalls: 0,
    upstreamExecutions: 0,
    provenance: {
      inference: "none (offline report parser)",
      execution: "none (source and harness prepared only)",
    },
    remainingGates: [
      "Certified isolated execution and upstream dependency staging",
      "Passing unchanged upstream build and all 50 original assertions",
      "Reproduced reported failure, independent reference and evaluator qualification",
      "Qualified repository admission and isolated generated candidate verification",
    ],
  };
  return { ...preparation, digest: sha256(JSON.stringify(preparation)) };
}
