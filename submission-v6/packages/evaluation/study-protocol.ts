import { readFileSync } from "node:fs";
import { z } from "zod";
import { sha256 } from "../evidence/hash.ts";
import { auditEvaluationProtocol } from "./protocol.ts";
import { studySchedule } from "./study-tasks.ts";
export const studyAssets = [
  "evaluation/STUDY_V1.md",
  "packages/evaluation/study-tasks.ts",
  "packages/evaluation/study-oracle.ts",
  "packages/evaluation/study-policy.ts",
  "packages/evaluation/study-protocol.ts",
  "packages/evaluation/study-execution.ts",
  "packages/evaluation/study-runner.ts",
  "packages/evaluation/study-metrics.ts",
  "apps/evaluator/study.ts",
  "tests/study.test.ts",
] as const;
// Canonical asset hash for this file excludes this one digest line to avoid self-reference.
export const frozenStudyDigest="b44cd230ac2b57220a041e19a27f37cbbab3dbd62d45cf816b953c1a0ff57a21";
export function studyAssetBytes(path: string) {
  const text = readFileSync(path, "utf8");
  return path === "packages/evaluation/study-protocol.ts"
    ? text.replace(
        /export const frozenStudyDigest\s*=\s*"[^"]*";/,
        'export const frozenStudyDigest="CANONICAL_DIGEST_PLACEHOLDER";',
      )
    : text;
}
const Hash = z.string().regex(/^[a-f0-9]{64}$/);
const Schema = z.strictObject({
  format: z.literal("repolab-development-study/v1"),
  baseProtocolDigest: Hash,
  frozenAt: z.iso.datetime(),
  scope: z.literal("three-exposed-development-tasks-no-held-out-claims"),
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
    .length(9),
  maxCandidates: z.literal(2),
  maxCalls: z.literal(6),
  maxOperations: z.literal(24),
  runInferenceCapUsd: z.literal(0.1),
  allocationUsd: z.literal(0.9),
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
      input ?? JSON.parse(readFileSync("evaluation/study-v1.json", "utf8")),
    ),
    { digest, ...payload } = p,
    base = auditEvaluationProtocol();
  if (
    digest !== frozenStudyDigest ||
    sha256(JSON.stringify(payload)) !== digest ||
    p.baseProtocolDigest !== base.digest ||
    JSON.stringify(p.schedule) !== JSON.stringify(studySchedule) ||
    JSON.stringify(p.parameters) !==
      JSON.stringify(base.comparison.parameters) ||
    new Set(p.assets.map((a) => a.path)).size !== studyAssets.length ||
    p.assets.some((a) => sha256(studyAssetBytes(a.path)) !== a.sha256)
  )
    throw Error("Study differs from its prospective freeze");
  return p;
}
