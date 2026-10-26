import { readFileSync } from "node:fs";
import { z } from "zod";
import { sha256 } from "../evidence/hash.ts";
import { auditCommonStudy as auditPreviousStudy } from "./study-protocol-v4.ts";
import { commonTaskIds } from "./study-adapters-v5.ts";
import type { CommonArm } from "./study-adapters-v5.ts";
export const frozenCommonStudyDigest =
  "41487293885b9230c0583c26fcda0b30d809c1f50f7adb955c0dc882dae18785";
export const commonStudyAssets = [
  "packages/evaluation/study-protocol-v5.ts",
  "packages/evaluation/study-policy-v5.ts",
  "packages/evaluation/study-adapters-v5.ts",
  "packages/evaluation/study-runner-v5.ts",
  "packages/evaluation/study-metrics-v5.ts",
  "apps/evaluator/study-v5.ts",
  "tests/study-v5.test.ts",
  "evaluation/STUDY_V5.md",
  "evaluation/study-v5-falsy-challenges.json",
] as const;
export const commonStudySchedule = commonTaskIds.map((task) => ({
  task,
  arm: "C" as const,
  repetition: 1,
}));
export function commonStudyAssetBytes(path: string) {
  const bytes = readFileSync(path, "utf8");
  return path === commonStudyAssets[0]
    ? bytes.replace(
        /export const frozenCommonStudyDigest =\s*"[a-f0-9]{64}";/,
        'export const frozenCommonStudyDigest = "' + "0".repeat(64) + '";',
      )
    : bytes;
}
export function auditCommonStudy() {
  const p = z
    .strictObject({
      format: z.literal("repolab-common-study/v5"),
      digest: z.string().regex(/^[a-f0-9]{64}$/),
      previousDigest: z.literal(
        "037e7a67ffe60ced80b59993b5cc168d78082a51f0bc072263b65a4a7b36e578",
      ),
      scope: z.literal(
        "focused-three-exposed-bug-revision-no-comparison-claim",
      ),
      model: z.literal("nvidia/nemotron-3-super-120b-a12b"),
      rates: z.strictObject({ input: z.literal(0.3), output: z.literal(0.9) }),
      maxCandidates: z.literal(2),
      maxCalls: z.literal(3),
      maxOperations: z.literal(32),
      runInferenceCapUsd: z.null(),
      allocationUsd: z.null(),
      globalInferenceCapUsd: z.literal(4),
      schedule: z
        .array(
          z.strictObject({
            task: z.enum(commonTaskIds),
            arm: z.enum(["A", "B", "C"]),
            repetition: z.literal(1),
          }),
        )
        .length(3),
      assets: z
        .array(
          z.strictObject({
            path: z.string(),
            sha256: z.string().regex(/^[a-f0-9]{64}$/),
          }),
        )
        .length(9),
    })
    .parse(JSON.parse(readFileSync("evaluation/study-v5.json", "utf8")));
  const { digest, ...payload } = p;
  if (
    digest !== frozenCommonStudyDigest ||
    sha256(JSON.stringify(payload)) !== digest ||
    auditPreviousStudy().digest !== p.previousDigest ||
    JSON.stringify(p.schedule) !== JSON.stringify(commonStudySchedule) ||
    p.assets.some(
      (a, i) =>
        a.path !== commonStudyAssets[i] ||
        sha256(commonStudyAssetBytes(a.path)) !== a.sha256,
    )
  )
    throw Error("Common study freeze changed");
  return p;
}
