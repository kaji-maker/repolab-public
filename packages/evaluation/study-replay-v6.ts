import { readFileSync } from "node:fs";
import { z } from "zod";
import { sha256 } from "../evidence/hash.ts";
import { auditCommonStudy } from "./study-protocol-v6.ts";
export const frozenReplayCorrectionDigest =
  "48dc96abb0d6069ff068ae0fdc9e5afd0c7971c96a6f42072c694dfa361453ff";
export const replayCorrectionAssets = [
  "packages/evaluation/study-replay-v6.ts",
  "packages/evaluation/study-metrics-v6-corrected.ts",
  "apps/evaluator/study-v6-replay.ts",
  "tests/study-v6-replay.test.ts",
  "evaluation/STUDY_V6_REPLAY.md",
] as const;
export function replayCorrectionBytes(path: string) {
  const bytes = readFileSync(path, "utf8");
  return path === replayCorrectionAssets[0]
    ? bytes.replace(
        /export const frozenReplayCorrectionDigest =\s*"[a-f0-9]{64}";/,
        'export const frozenReplayCorrectionDigest = "' + "0".repeat(64) + '";',
      )
    : bytes;
}
export function auditReplayCorrection() {
  const p = z
    .strictObject({
      format: z.literal("repolab-offline-replay-correction/v1"),
      digest: z.string().regex(/^[a-f0-9]{64}$/),
      previousDigest: z.literal(
        "2aba74d2572eed04db456e264d12fb2ef1d97221f002c011e036b81b0bede1b8",
      ),
      scope: z.literal(
        "retrospective-read-only-v6-receipt-reanalysis-no-new-model-outcomes",
      ),
      allowedChange: z.literal("metrics-gate-replay-import-v5-to-v6-only"),
      assets: z
        .array(
          z.strictObject({
            path: z.string(),
            sha256: z.string().regex(/^[a-f0-9]{64}$/),
          }),
        )
        .length(5),
    })
    .parse(JSON.parse(readFileSync("evaluation/study-v6-replay.json", "utf8")));
  const { digest, ...payload } = p;
  const original = readFileSync(
    "packages/evaluation/study-metrics-v6.ts",
    "utf8",
  );
  const corrected = readFileSync(
    "packages/evaluation/study-metrics-v6-corrected.ts",
    "utf8",
  );
  if (
    digest !== frozenReplayCorrectionDigest ||
    sha256(JSON.stringify(payload)) !== digest ||
    auditCommonStudy().digest !== p.previousDigest ||
    corrected !==
      original.replace(
        'from "./study-runner-v5.ts"',
        'from "./study-runner-v6.ts"',
      ) ||
    p.assets.some(
      (a, i) =>
        a.path !== replayCorrectionAssets[i] ||
        sha256(replayCorrectionBytes(a.path)) !== a.sha256,
    )
  )
    throw Error("Offline replay correction changed");
  return p;
}
