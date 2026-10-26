import { readFileSync } from "node:fs";
import { z } from "zod";
import { sha256 } from "../evidence/hash.ts";
import { auditUnrunControls } from "./unrun-controls.ts";
import { commonTaskIds } from "./study-adapters-v4.ts";
import type { CommonArm } from "./study-adapters-v4.ts";
export const frozenCommonStudyDigest = "037e7a67ffe60ced80b59993b5cc168d78082a51f0bc072263b65a4a7b36e578";
export const commonStudyAssets = [
  "packages/evaluation/study-protocol-v4.ts",
  "packages/evaluation/study-policy-v4.ts",
  "packages/evaluation/study-adapters-v4.ts",
  "packages/evaluation/study-runner-v4.ts",
  "packages/evaluation/study-metrics-v4.ts",
  "apps/evaluator/study-v4.ts",
  "tests/study-v4.test.ts",
  "evaluation/STUDY_V4.md",
] as const;
export const commonStudySchedule = commonTaskIds.flatMap((task, i) =>
  ([0, 1, 2] as const).map((j) => ({
    task,
    arm: (["A", "B", "C"] as CommonArm[])[(i + j) % 3],
    repetition: 1,
  })),
);
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
      format: z.literal("repolab-common-study/v4"),
      digest: z.string().regex(/^[a-f0-9]{64}$/),
      previousDigest: z.literal(
        "c98680cfa17ea2d0c5ac5fa2bbd0b73a72c57291878136636cdce1127b06954f",
      ),
      scope: z.literal(
        "eight-authored-public-exposed-tasks-no-external-heldout-claim",
      ),
      model: z.literal("nvidia/nemotron-3-super-120b-a12b"),
      rates: z.strictObject({ input: z.literal(0.3), output: z.literal(0.9) }),
      maxCandidates: z.literal(2),
      maxCalls: z.literal(3),
      maxOperations: z.literal(32),
      runInferenceCapUsd: z.literal(0.1),
      allocationUsd: z.literal(1.8),
      globalInferenceCapUsd: z.literal(4),
      schedule: z
        .array(
          z.strictObject({
            task: z.enum(commonTaskIds),
            arm: z.enum(["A", "B", "C"]),
            repetition: z.literal(1),
          }),
        )
        .length(24),
      assets: z
        .array(
          z.strictObject({
            path: z.string(),
            sha256: z.string().regex(/^[a-f0-9]{64}$/),
          }),
        )
        .length(8),
    })
    .parse(JSON.parse(readFileSync("evaluation/study-v4.json", "utf8")));
  const { digest, ...payload } = p;
  if (
    digest !== frozenCommonStudyDigest ||
    sha256(JSON.stringify(payload)) !== digest ||
    auditUnrunControls().digest !== p.previousDigest ||
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
