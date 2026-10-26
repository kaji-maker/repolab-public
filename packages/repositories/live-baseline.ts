import { z } from "zod";
import { sha256 } from "../evidence/hash.ts";
import {
  getBaselinePlan,
  checkBaselineExecution,
  inspectBaselineTap,
} from "./baseline.ts";
import { getClsxEvaluationVariant } from "../evaluation/clsx.ts";
import type { Execution, Gate } from "../contracts/index.ts";

/** Only the pinned original and independently reviewed reference are admitted here. */
export function getLiveBaselinePlan(
  snapshot: unknown,
  variant: "original" | "reference",
) {
  const plan = getBaselinePlan(snapshot);
  if (variant === "original") return { ...plan, variant };
  if (variant !== "reference")
    throw new Error(
      "Only original/reference baseline preparation is supported",
    );
  const reference = getClsxEvaluationVariant(snapshot, "reference");
  const match = /const config = (.+);\nif \(!config\)/.exec(plan.runner);
  if (!match) throw new Error("Pinned baseline configuration marker missing");
  const prior = JSON.parse(match[1]);
  const { recipeDigest: _, ...config } = prior;
  const files = plan.files.map((f) =>
    f.path === "src/index.js"
      ? { ...f, content: reference.source, sha256: reference.sourceHash }
      : f,
  );
  config.files = files.map(({ path, sha256 }) => ({ path, sha256 }));
  const recipeDigest = sha256(JSON.stringify(config));
  const runner = plan.runner.replace(
    match[1],
    JSON.stringify({ ...config, recipeDigest }),
  );
  return {
    ...plan,
    variant,
    sourceHash: reference.sourceHash,
    files,
    recipeDigest,
    runner,
    runnerHash: sha256(runner),
  };
}
export function checkLiveBaseline(
  snapshot: unknown,
  variant: "original" | "reference",
  execution: Execution,
): Gate {
  if (variant === "original")
    return checkBaselineExecution(snapshot, execution);
  const plan = getLiveBaselinePlan(snapshot, variant);
  const fail = (detail: string) => ({
    name: "Reviewed reference upstream baseline",
    passed: false,
    detail,
  });
  if (
    execution.provider !== "nebius-sandbox" ||
    ![execution.id, execution.operationId, execution.image].every(
      (v) => z.uuid().safeParse(v).success,
    ) ||
    execution.sourceHash !== plan.sourceHash ||
    execution.testHash !== plan.runnerHash ||
    execution.exitCode !== 0 ||
    execution.signal ||
    execution.timedOut ||
    execution.truncated ||
    !/^v24\.\d+\.\d+$/.test(execution.runtimeVersion ?? "") ||
    Buffer.byteLength(execution.stdout) > 131072
  )
    return fail("Complete isolated reference execution required");
  try {
    const step = z.object({
      exitCode: z.literal(0),
      signal: z.null(),
      timedOut: z.literal(false),
      truncated: z.literal(false),
      error: z.null(),
      stdout: z.string().max(16384),
      stderr: z.string().max(16384),
    });
    const result = z
      .strictObject({
        protocol: z.literal("repolab-upstream-baseline/v1"),
        recipeDigest: z.literal(plan.recipeDigest),
        runtimeVersion: z.literal(execution.runtimeVersion!),
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
      .parse(JSON.parse(execution.stdout));
    for (const hashes of [result.before, result.after])
      if (
        Object.keys(hashes).length !== plan.files.length ||
        plan.files.some((f) => hashes[f.path] !== f.sha256)
      )
        return fail("Reference or unchanged upstream inputs were modified");
    if (
      result.artifacts.some((a, i) => a.path !== plan.expectedArtifacts[i]) ||
      result.artifacts[1].sha256 !== plan.sourceHash
    )
      return fail("Reference build artifacts mismatch");
    const tap = inspectBaselineTap(snapshot, result.regression.stdout);
    if (!tap.valid) return fail(tap.reason);
    return {
      name: "Reviewed reference upstream baseline",
      passed: true,
      detail:
        "Reviewed reference passes the unchanged original 50-assertion regression suite",
    };
  } catch {
    return fail("Incomplete reference baseline evidence");
  }
}
