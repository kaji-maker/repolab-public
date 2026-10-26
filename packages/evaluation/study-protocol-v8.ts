import { readFileSync } from "node:fs";
import { z } from "zod";
import { sha256 } from "../evidence/hash.ts";
import { auditCommonStudy as auditPreviousStudy } from "./study-protocol-v7.ts";
import { commonTaskIds } from "./study-adapters-v6.ts";
import type { CommonArm } from "./study-adapters-v6.ts";
export const frozenCommonStudyDigest =
  "4e1512b8c09a6acde9d7e77d280bc65a79c76cf1842db435707debb2a36f9e47";
export const commonStudyAssets = [
  "packages/evaluation/study-protocol-v8.ts",
  "packages/evaluation/study-guidance-v8.ts",
  "packages/evaluation/study-runner-v8.ts",
  "packages/evaluation/study-metrics-v8.ts",
  "apps/evaluator/study-v8.ts",
  "tests/study-v8.test.ts",
  "evaluation/STUDY_V8.md",
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
      format: z.literal("repolab-common-study/v8"),
      digest: z.string().regex(/^[a-f0-9]{64}$/),
      previousDigest: z.literal(
        "351992246bc03f1571c94e7d52ef135c250d23abc5203ab44298e6d4be0f5ccd",
      ),
      scope: z.literal("focused-mri-type-guidance-exposed-no-comparison-claim"),
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
        .length(1),
      assets: z
        .array(
          z.strictObject({
            path: z.string(),
            sha256: z.string().regex(/^[a-f0-9]{64}$/),
          }),
        )
        .length(7),
    })
    .parse(JSON.parse(readFileSync("evaluation/study-v8.json", "utf8")));
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
