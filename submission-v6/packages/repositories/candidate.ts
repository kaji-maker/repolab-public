import { readFileSync } from "node:fs";
import { z } from "zod";
import { getBaselinePlan, inspectBaselineTap } from "./baseline.ts";
import { checkCandidateSource } from "./candidate-policy.ts";
import { sha256 } from "../evidence/hash.ts";
import { validateCompiledTests } from "../controller/tests.ts";
import { inspectObservations } from "../controller/observations.ts";
import type { ExpectedObservation } from "../controller/observations.ts";
import type { Execution, Gate } from "../contracts/index.ts";

export function getCandidatePlan(snapshot: unknown, source: string) {
  checkCandidateSource(source);
  const original = getBaselinePlan(snapshot);
  const match = /const config = (.+);\nif \(!config\)/.exec(original.runner);
  if (!match) throw Error("Original recipe marker missing");
  const { recipeDigest: _, ...prior } = JSON.parse(match[1]);
  const files = original.files.map((f) =>
    f.path === "src/index.js"
      ? { ...f, content: source, sha256: sha256(source) }
      : f,
  );
  const template = readFileSync(
    "repositories/clsx-baseline/candidate-runner.mjs",
    "utf8",
  );
  const config = {
    ...prior,
    files: files.map(({ path, sha256 }) => ({ path, sha256 })),
    candidateTemplateHash: sha256(template),
  };
  const recipeDigest = sha256(JSON.stringify(config));
  const runner = template.replace(
    "/*REPOLAB_CANDIDATE_CONFIG*/ null",
    JSON.stringify({ ...config, recipeDigest }),
  );
  return {
    ...original,
    sourceHash: sha256(source),
    files,
    recipeDigest,
    runner,
    runnerHash: sha256(runner),
  };
}
export function isolatedIdentity(
  e: Execution,
  sourceHash: string,
  testHash: string,
  image: string,
) {
  return (
    e.provider === "nebius-sandbox" &&
    [e.id, e.operationId, e.image, image].every(
      (v) => z.uuid().safeParse(v).success,
    ) &&
    e.image === image &&
    e.sourceHash === sourceHash &&
    e.testHash === testHash &&
    e.runtimeVersion === "v24.18.0" &&
    e.exitCode === 0 &&
    e.signal === null &&
    e.timedOut === false &&
    e.truncated === false
  );
}
export function checkCandidateBaseline(
  snapshot: unknown,
  source: string,
  e: Execution,
  image: string,
): Gate {
  const plan = getCandidatePlan(snapshot, source);
  const fail = (detail: string) => ({
    name: "Candidate unchanged upstream regression",
    passed: false,
    detail,
  });
  if (
    !isolatedIdentity(e, plan.sourceHash, plan.runnerHash, image) ||
    Buffer.byteLength(e.stdout) > 131072
  )
    return fail("Incomplete isolated baseline identity/result");
  try {
    const step = z.strictObject({
      exitCode: z.literal(0),
      signal: z.null(),
      timedOut: z.literal(false),
      truncated: z.literal(false),
      error: z.null(),
      stdout: z.string().max(16384),
      stderr: z.string().max(16384),
    });
    const body = z
      .strictObject({
        protocol: z.literal("repolab-candidate-baseline/v1"),
        recipeDigest: z.literal(plan.recipeDigest),
        runtimeVersion: z.literal("v24.18.0"),
        before: z.record(z.string(), z.string()),
        after: z.record(z.string(), z.string()),
        artifacts: z
          .array(
            z.strictObject({
              path: z.string(),
              sha256: z.string().regex(/^[a-f0-9]{64}$/),
              bytes: z.number().int().min(1).max(32768),
            }),
          )
          .length(3),
        build: step,
        regression: step,
      })
      .parse(JSON.parse(e.stdout));
    for (const hashes of [body.before, body.after])
      if (
        Object.keys(hashes).length !== plan.files.length ||
        plan.files.some((f) => hashes[f.path] !== f.sha256)
      )
        return fail("Candidate or original tests/lock/metadata changed");
    if (
      body.artifacts.some((a, i) => a.path !== plan.expectedArtifacts[i]) ||
      body.artifacts[1].sha256 !== plan.sourceHash
    )
      return fail("Candidate build artifacts mismatch");
    const tap = inspectBaselineTap(snapshot, body.regression.stdout);
    return tap.valid
      ? {
          name: "Candidate unchanged upstream regression",
          passed: true,
          detail:
            "All original 50 assertions and 24 groups pass; seven input hashes unchanged",
        }
      : fail(tap.reason);
  } catch {
    return fail("Build, regression or integrity evidence incomplete");
  }
}
export function checkCandidateObservations(
  source: string,
  tests: string,
  expected: readonly ExpectedObservation[],
  e: Execution,
  image: string,
) {
  checkCandidateSource(source);
  if (validateCompiledTests(tests, false) !== "src/index.js")
    throw Error("clsx harness required");
  if (!isolatedIdentity(e, sha256(source), sha256(tests), image))
    return {
      valid: false,
      rows: [],
      error: "Isolated source/harness/image identity mismatch",
    };
  return inspectObservations(e, expected);
}
export function checkCandidateStage(
  plan: ReturnType<typeof getCandidatePlan>,
  treeDigest: string,
  e: Execution,
  image: string,
  testHash: string,
  resultImage: unknown,
) {
  if (
    !isolatedIdentity(e, plan.sourceHash, testHash, image) ||
    !z.uuid().safeParse(resultImage).success ||
    image === resultImage
  )
    throw Error("Candidate staging identity incomplete");
  const body = z
    .strictObject({
      protocol: z.literal("repolab-candidate-stage/v1"),
      runtimeVersion: z.literal("v24.18.0"),
      passed: z.literal(true),
      protectedWorkspace: z.literal(true),
      treeDigest: z.literal(treeDigest),
      inputs: z.record(z.string(), z.string()),
    })
    .parse(JSON.parse(e.stdout));
  if (
    Object.keys(body.inputs).length !== plan.files.length ||
    plan.files.some((f) => body.inputs[f.path] !== f.sha256)
  )
    throw Error("Staged candidate/input mismatch");
  return {
    name: "Candidate protected staging",
    passed: true,
    detail:
      "Root owns read-only workspace, source, original tests and dependencies; fresh writable dist only",
  };
}
export function checkCandidateControls(
  source: string,
  e: Execution,
  image: string,
  testHash: string,
) {
  if (!isolatedIdentity(e, sha256(source), testHash, image))
    throw Error("Candidate controls identity incomplete");
  const names = [
    "source-write",
    "source-unlink",
    "source-directory-rename",
    "test-write",
    "test-directory-rename",
    "lock-write",
    "dependency-rename",
    "runner-write",
    "alternative-config",
  ];
  const body = z
    .strictObject({
      protocol: z.literal("repolab-candidate-controls/v1"),
      runtimeVersion: z.literal("v24.18.0"),
      uid: z.literal(1000),
      sourceBefore: z.literal(sha256(source)),
      sourceAfter: z.literal(sha256(source)),
      checks: z
        .array(z.strictObject({ name: z.string(), passed: z.literal(true) }))
        .length(names.length),
      passed: z.literal(true),
    })
    .parse(JSON.parse(e.stdout));
  if (body.checks.some((c, i) => c.name !== names[i]))
    throw Error("Candidate integrity counterexamples missing");
  return {
    name: "Candidate filesystem counterexamples",
    passed: true,
    detail:
      "All nine attempted source/test/lock/dependency/runner replacements denied",
  };
}
