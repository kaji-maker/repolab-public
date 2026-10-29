import { readFileSync } from "node:fs";
import { z } from "zod";
import { sha256 } from "../evidence/hash.ts";
import { auditEvaluationProtocol } from "./protocol.ts";
import { auditStudy as auditPreviousStudy } from "./study-protocol-v2.ts";
export const studySchedule = [
  { task: "clsx-object-push", arm: "C", repetition: 1 },
] as const;
export const studyAssets = [
  "evaluation/STUDY_V3.md",
  "fixtures/study-v3-exception.mjs",
  "packages/evaluation/study-expression-edits-v3.ts",
  "packages/evaluation/study-observation-v3.ts",
  "packages/evaluation/study-protocol-v3.ts",
  "packages/evaluation/study-runner-v3.ts",
  "packages/evaluation/study-metrics-v3.ts",
  "apps/evaluator/study-v3.ts",
  "tests/study-v3.test.ts",
] as const;
// Canonical asset hash for this file excludes this one digest line to avoid self-reference.
export const frozenStudyDigest="ecf9a092ccd36965b32c8256608a61443ec18618c5906e9fd8810710674824bf";
export function studyAssetBytes(path: string) {
  const text = readFileSync(path, "utf8");
  return path === "packages/evaluation/study-protocol-v3.ts"
    ? text.replace(
        /export const frozenStudyDigest\s*=\s*"[^"]*";/,
        'export const frozenStudyDigest="CANONICAL_DIGEST_PLACEHOLDER";',
      )
    : text;
}
const Hash = z.string().regex(/^[a-f0-9]{64}$/);
const Schema = z.strictObject({
  format: z.literal("repolab-development-robustness-study/v3"),
  baseProtocolDigest: Hash,
  previousStudyDigest: Hash,
  policyVersion: z.literal(
    "pure-source-diagnostics-v2-plus-validated-expression-edits-v3",
  ),
  contractVersion: z.literal("nonnullable-grounded-contract-v2"),
  observationVersion: z.literal("complete-behavioral-failure-v3"),
  repairPromptVersion: z.literal("existing-expression-edits-v3"),
  frozenAt: z.iso.datetime(),
  scope: z.literal("one-historical-development-workflow-no-comparison-claim"),
  schedule: z
    .array(
      z.strictObject({
        task: z.enum([
          "booking-timezone",
          "checkout-quantity",
          "clsx-object-push",
        ]),
        arm: z.enum(["A", "B", "C"]),
        repetition: z.literal(1),
      }),
    )
    .length(1),
  maxCandidates: z.literal(2),
  maxCalls: z.literal(6),
  maxOperations: z.literal(24),
  runInferenceCapUsd: z.literal(0.1),
  allocationUsd: z.literal(0.1),
  model: z.literal("nvidia/nemotron-3-super-120b-a12b"),
  parameters: z.unknown(),
  rates: z.strictObject({ input: z.literal(0.3), output: z.literal(0.9) }),
  assets: z
    .array(z.strictObject({ path: z.enum(studyAssets), sha256: Hash }))
    .length(studyAssets.length),
  digest: Hash,
});
export function auditStudy(input?: unknown) {
  const p = Schema.parse(
      input ?? JSON.parse(readFileSync("evaluation/study-v3.json", "utf8")),
    ),
    { digest, ...payload } = p,
    base = auditEvaluationProtocol();
  if (
    digest !== frozenStudyDigest ||
    sha256(JSON.stringify(payload)) !== digest ||
    p.baseProtocolDigest !== base.digest ||
    p.previousStudyDigest !== auditPreviousStudy().digest ||
    JSON.stringify(p.schedule) !== JSON.stringify(studySchedule) ||
    JSON.stringify(p.parameters) !==
      JSON.stringify(base.comparison.parameters) ||
    new Set(p.assets.map((a) => a.path)).size !== studyAssets.length ||
    p.assets.some((a) => sha256(studyAssetBytes(a.path)) !== a.sha256)
  )
    throw Error("Study differs from its prospective freeze");
  return p;
}
