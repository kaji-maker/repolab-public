import { readFileSync } from "node:fs";
import { z } from "zod";
import { sha256 } from "../evidence/hash.ts";
import { compileTests } from "../controller/tests.ts";
import { ClsxContractSchema } from "../contracts/index.ts";
import { groundContract } from "../providers/fixture.ts";
import { getBaselinePlan } from "./baseline.ts";
import { getClsxRepairPlan } from "./clsx-repair.ts";
import { getQualificationPlan } from "./qualification.ts";
import { checkCandidateSource } from "./candidate-policy.ts";
import {
  getCandidatePlan,
  checkCandidateStage,
  checkCandidateControls,
  checkCandidateBaseline,
  checkCandidateObservations,
} from "./candidate.ts";
import { compileOriginalControls } from "./original-controls.ts";
import { getClsxEvaluationPlan } from "../evaluation/clsx.ts";
import {
  auditEvaluationProtocol,
  archivalEvaluationReader,
} from "../evaluation/protocol.ts";
import { providerSecrets } from "./repair-view.ts";

const Hash = z.string().regex(/^[a-f0-9]{64}$/);
const File = z.strictObject({
  path: z.string().max(100),
  content: z.string().max(131072),
  sha256: Hash,
});
const Decision = z.strictObject({
  format: z.literal("repolab-clsx-pilot-decision/v1"),
  runId: z.uuid(),
  protocolDigest: Hash,
  certificateDigest: Hash,
  at: z.iso.datetime(),
  accepted: z.literal(true),
  attempt: z.number().int().min(1).max(2),
  sourceHash: Hash,
  source: z.string().min(20).max(16000),
  coreHash: Hash,
  expectationsHash: Hash,
  candidateHashes: z.array(Hash).min(1).max(2),
});
const Payload = z.strictObject({
  format: z.literal("repolab-clsx-pack/v1"),
  profile: z.literal("clsx-object-push"),
  scope: z.literal("exposed-historical-development-task"),
  origin: z.strictObject({
    runId: z.uuid(),
    protocolVersion: z.number().int().min(7).max(9),
    protocolDigest: Hash,
    model: z.literal("nvidia/nemotron-3-super-120b-a12b"),
    inference: z.literal(
      "recorded-nebius-controller-evidence-not-provider-authenticated",
    ),
    completedAt: z.iso.datetime(),
    independentOpenedAt: z.iso.datetime(),
    inferenceCalls: z.number().int().min(1).max(6),
    inputTokens: z.number().int().nonnegative(),
    outputTokens: z.number().int().nonnegative(),
    estimatedInferenceUsd: z.number().nonnegative().max(0.1),
  }),
  original: z.strictObject({
    snapshot: z.unknown(),
    snapshotDigest: Hash,
    files: z.array(File).length(7),
    license: z.strictObject({
      spdx: z.literal("MIT"),
      text: z.string().max(4000),
    }),
    lockHash: Hash,
  }),
  dependency: z.strictObject({
    originalImage: z.uuid(),
    treeDigest: Hash,
    runtimeVersion: z.literal("v24.18.0"),
  }),
  report: z.string().min(20).max(8000),
  reportHash: Hash,
  contract: ClsxContractSchema,
  source: z.strictObject({
    path: z.literal("src/index.js"),
    content: z.string().min(20).max(16000),
    sha256: Hash,
  }),
  core: z.strictObject({
    tests: z.string().max(16000),
    hash: Hash,
    expectationsHash: Hash,
  }),
  decision: z.strictObject({ payload: Decision, sha256: Hash }),
  patch: z.strictObject({ content: z.string().max(40000), sha256: Hash }),
  regression: z.strictObject({
    path: z.literal("repolab-regression.mjs"),
    content: z.string().max(64000),
    sha256: Hash,
    scope: z.literal("sourced-report-only-not-independent-evaluator"),
  }),
  limitations: z.tuple([
    z.literal(
      "Hashes bind bytes, not provider identity; replay establishes a new scoped execution result",
    ),
    z.literal(
      "Original tests and dependency lock are unchanged; one development task is not held-out accuracy",
    ),
  ]),
});
const PackSchema = Payload.extend({ digest: Hash });
export type ClsxPack = z.infer<typeof PackSchema>;

export function clsxSnapshot() {
  return JSON.parse(
    readFileSync("fixtures/clsx-upstream/original-snapshot.json", "utf8"),
  );
}
function recognizedProtocol(version: number, digest: string) {
  const manifest = JSON.parse(
    readFileSync(`evaluation/protocol-v${version}.json`, "utf8"),
  );
  const protocol = auditEvaluationProtocol(
    manifest,
    version < 9 ? archivalEvaluationReader(version as 7 | 8) : undefined,
  );
  if (protocol.digest !== digest) throw Error("Unknown origin protocol");
  return protocol;
}
export function sourcePatch(original: string, candidate: string) {
  const lines = (s: string) => {
    const rows = s.split("\n");
    if (s.endsWith("\n")) rows.pop();
    return rows;
  };
  const before = lines(original),
    after = lines(candidate);
  const block = (rows: string[], prefix: string, hasNewline: boolean) =>
    rows.map((line) => prefix + line + "\n").join("") +
    (hasNewline ? "" : "\\ No newline at end of file\n");
  return (
    `diff --git a/src/index.js b/src/index.js\n--- a/src/index.js\n+++ b/src/index.js\n@@ -1,${before.length} +1,${after.length} @@\n` +
    block(before, "-", original.endsWith("\n")) +
    block(after, "+", candidate.endsWith("\n"))
  );
}
export function sourcedRegression(
  contract: z.infer<typeof ClsxContractSchema>,
) {
  return (
    `// ReproLab sourced report regression. Run only with isolated execution.\n` +
    `// Convenience assertions; authoritative replay compares observations in the controller.\n` +
    `import assert from 'node:assert/strict';\nimport { resolve } from 'node:path';\nimport { pathToFileURL } from 'node:url';\n` +
    `const { default: clsx } = await import(pathToFileURL(resolve(process.argv[2] ?? 'src/index.js')).href);\n` +
    `const cases = ${JSON.stringify(contract.expectations, null, 2)};\n` +
    `for (const c of cases) assert.equal(clsx(...c.args), c.expected, c.id + ': ' + c.sourceQuote);\n` +
    `console.log(cases.length + ' sourced report checks passed');\n`
  );
}
function noCredentials(value: unknown, secrets: string[]) {
  const text = JSON.stringify(value);
  if (secrets.some((s) => s && text.includes(s)))
    throw Error("Credential-bearing artifacts cannot be exported or replayed");
}
/** Data-only parsing. Imported source is never evaluated on the controller. */
export function readClsxPack(
  input: unknown,
  secrets = providerSecrets(),
): ClsxPack {
  if (
    Buffer.byteLength(
      typeof input === "string" ? input : JSON.stringify(input),
    ) > 524288
  )
    throw Error("Repository pack exceeds byte cap");
  const raw = typeof input === "string" ? JSON.parse(input) : input;
  noCredentials(raw, secrets);
  const pack = PackSchema.parse(raw),
    { digest, ...payload } = pack;
  if (sha256(JSON.stringify(payload)) !== digest)
    throw Error("Repository pack digest mismatch");
  const protocol = recognizedProtocol(
    pack.origin.protocolVersion,
    pack.origin.protocolDigest,
  );
  const baseline = getBaselinePlan(pack.original.snapshot),
    repair = getClsxRepairPlan(pack.original.snapshot);
  if (
    pack.original.snapshotDigest !== baseline.snapshotDigest ||
    JSON.stringify(pack.original.files) !== JSON.stringify(baseline.files) ||
    JSON.stringify(pack.original.license) !==
      JSON.stringify(baseline.license) ||
    pack.original.lockHash !== baseline.lockHash ||
    pack.report !== repair.report ||
    pack.reportHash !== sha256(pack.report)
  )
    throw Error("Pinned original/report/lock identity changed");
  const grounded = ClsxContractSchema.parse(
    groundContract(pack.report, pack.contract, "clsx-object-push"),
  );
  const tests = compileTests(
    grounded.expectations.map(({ sourceQuote: _, ...p }) => p),
  );
  checkCandidateSource(pack.source.content);
  if (
    pack.source.sha256 !== sha256(pack.source.content) ||
    pack.core.tests !== tests ||
    pack.core.hash !== sha256(tests) ||
    pack.core.expectationsHash !== sha256(JSON.stringify(grounded.expectations))
  )
    throw Error("Source or frozen report inputs changed");
  const d = pack.decision.payload;
  if (
    sha256(JSON.stringify(d, null, 2) + "\n") !== pack.decision.sha256 ||
    d.runId !== pack.origin.runId ||
    d.protocolDigest !== protocol.digest ||
    d.source !== pack.source.content ||
    d.sourceHash !== pack.source.sha256 ||
    d.coreHash !== pack.core.hash ||
    d.expectationsHash !== pack.core.expectationsHash ||
    d.candidateHashes[d.attempt - 1] !== d.sourceHash ||
    Date.parse(d.at) > Date.parse(pack.origin.independentOpenedAt) ||
    Date.parse(pack.origin.independentOpenedAt) >
      Date.parse(pack.origin.completedAt)
  )
    throw Error("Pre-evaluation source selection changed");
  if (
    pack.patch.content !== sourcePatch(repair.source, pack.source.content) ||
    pack.patch.sha256 !== sha256(pack.patch.content) ||
    pack.regression.content !== sourcedRegression(grounded) ||
    pack.regression.sha256 !== sha256(pack.regression.content)
  )
    throw Error("Patch or sourced regression changed");
  return pack;
}

/** Export only a completed locally validated acceptance; raw provider replies stay private. */
export function exportClsxPack(
  record: Record<string, any>,
  decisionBytes: string,
  secrets = providerSecrets(),
) {
  if (
    record.status !== "VERIFIED_FOR_TESTED_SCENARIOS" ||
    record.success !== true ||
    record.selectionIntegrity !== true ||
    record.usageComplete !== true ||
    record.qualifiedBugWorkflowsAttempted !== 1
  )
    throw Error("A completed verified selected repair is required");
  const decision = Decision.parse(JSON.parse(decisionBytes));
  if (sha256(decisionBytes) !== record.decision?.sha256)
    throw Error("Saved decision bytes changed");
  const snapshot = clsxSnapshot(),
    base = getBaselinePlan(snapshot),
    repair = getClsxRepairPlan(snapshot),
    qual = getQualificationPlan(snapshot);
  const c = record.candidates?.find((c: any) => c.attempt === decision.attempt);
  if (
    !c?.accepted ||
    c.sourceHash !== decision.sourceHash ||
    c.patch?.content !== decision.source ||
    !record.modelResponses?.some((m: any) => {
      try {
        const p = JSON.parse(m.choices[0].content);
        return p.path === "src/index.js" && p.content === decision.source;
      } catch {
        return false;
      }
    })
  )
    throw Error("Selected source lacks recorded model correspondence");
  const plan = getCandidatePlan(snapshot, decision.source),
    executions = c.executions;
  if (executions?.length !== 7 || record.originalExecutions?.length !== 3)
    throw Error("Complete original/candidate evidence required");
  const tree = record.admission?.dependency?.treeDigest,
    image = record.dependencyImage;
  const template = readFileSync(
    "repositories/clsx-baseline/candidate-stage.mjs",
    "utf8",
  );
  const stage = template.replace(
    "/*REPOLAB_CANDIDATE_STAGE_CONFIG*/ null",
    JSON.stringify({
      treeDigest: tree,
      files: plan.files.map(({ path, sha256 }) => ({ path, sha256 })),
    }),
  );
  const fs = readFileSync(
    "repositories/clsx-baseline/candidate-controls.mjs",
    "utf8",
  );
  checkCandidateStage(
    plan,
    tree,
    executions[0],
    image,
    sha256(stage),
    c.stagedImage,
  );
  checkCandidateControls(
    decision.source,
    executions[1],
    c.stagedImage,
    sha256(fs),
  );
  if (
    ![2, 6].every(
      (i) =>
        checkCandidateBaseline(
          snapshot,
          decision.source,
          executions[i],
          c.stagedImage,
        ).passed,
    )
  )
    throw Error("Original upstream regression evidence invalid");
  const controls = compileOriginalControls(snapshot);
  const check = (source: string, tests: string, expected: any, e: any) =>
    checkCandidateObservations(source, tests, expected, e, image);
  const originalControls = check(
    repair.source,
    controls,
    qual.baselineControls,
    record.originalExecutions[0],
  );
  const contract = ClsxContractSchema.parse(
    groundContract(repair.report, record.contract, "clsx-object-push"),
  );
  const tests = compileTests(
    contract.expectations.map(({ sourceQuote: _, ...p }) => p),
  );
  const originals = [1, 2].map((i) =>
    check(
      repair.source,
      tests,
      contract.expectations,
      record.originalExecutions[i],
    ),
  );
  const cores = [3, 5].map((i) =>
    check(decision.source, tests, contract.expectations, executions[i]),
  );
  const preserved = check(
    decision.source,
    controls,
    qual.baselineControls,
    executions[4],
  );
  const evaluation = getClsxEvaluationPlan(snapshot),
    independent = check(
      decision.source,
      evaluation.tests,
      evaluation.cases,
      record.independent?.execution,
    );
  const all = [
    ...record.originalExecutions,
    ...executions,
    record.independent.execution,
  ];
  if (
    ![originalControls, ...cores, preserved, independent].every(
      (r) => r.valid && r.rows.every((p) => p.passed),
    ) ||
    !originals.every((r) => r.valid && r.rows.some((p) => !p.passed)) ||
    JSON.stringify(originals[0].rows) !== JSON.stringify(originals[1].rows) ||
    new Set(all.map((e) => e.operationId)).size !== 11 ||
    new Set(all.map((e) => e.id)).size !== 11
  )
    throw Error("Report/control/fresh/independent evidence invalid");
  // Keep the origin freeze rather than assigning the outcome to today's version.
  let originVersion: number | undefined;
  for (const v of [7, 8, 9]) {
    try {
      if (
        JSON.parse(readFileSync(`evaluation/protocol-v${v}.json`, "utf8"))
          .digest === record.protocolDigest
      )
        originVersion = v;
    } catch {}
  }
  if (!originVersion) throw Error("Unrecognized repair origin freeze");
  const regression = sourcedRegression(contract),
    patch = sourcePatch(repair.source, decision.source);
  const payload = {
    format: "repolab-clsx-pack/v1" as const,
    profile: "clsx-object-push" as const,
    scope: "exposed-historical-development-task" as const,
    origin: {
      runId: record.id,
      protocolVersion: originVersion,
      protocolDigest: record.protocolDigest,
      model: record.model,
      inference:
        "recorded-nebius-controller-evidence-not-provider-authenticated" as const,
      completedAt: record.completedAt,
      independentOpenedAt: record.independentOpenedAt,
      inferenceCalls: record.inferenceCalls,
      inputTokens: record.usage.reduce(
        (n: number, u: any) => n + u.inputTokens,
        0,
      ),
      outputTokens: record.usage.reduce(
        (n: number, u: any) => n + u.outputTokens,
        0,
      ),
      estimatedInferenceUsd: record.estimatedInferenceUsd,
    },
    original: {
      snapshot,
      snapshotDigest: base.snapshotDigest,
      files: base.files,
      license: base.license,
      lockHash: base.lockHash,
    },
    dependency: {
      originalImage: image,
      treeDigest: tree,
      runtimeVersion: "v24.18.0" as const,
    },
    report: record.report,
    reportHash: record.reportHash,
    contract,
    source: {
      path: "src/index.js" as const,
      content: decision.source,
      sha256: decision.sourceHash,
    },
    core: record.core
      ? {
          tests: record.core.tests,
          hash: record.core.hash,
          expectationsHash: record.core.expectationsHash,
        }
      : null,
    decision: { payload: decision, sha256: record.decision.sha256 },
    patch: { content: patch, sha256: sha256(patch) },
    regression: {
      path: "repolab-regression.mjs" as const,
      content: regression,
      sha256: sha256(regression),
      scope: "sourced-report-only-not-independent-evaluator" as const,
    },
    limitations: [
      "Hashes bind bytes, not provider identity; replay establishes a new scoped execution result",
      "Original tests and dependency lock are unchanged; one development task is not held-out accuracy",
    ] as const,
  };
  return readClsxPack(
    { ...payload, digest: sha256(JSON.stringify(payload)) },
    secrets,
  );
}
