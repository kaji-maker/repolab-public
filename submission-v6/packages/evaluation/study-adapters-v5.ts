import { readFileSync } from "node:fs";
import { z } from "zod";
import {
  commonTask as previousTask,
  commonIndependent as previousIndependent,
  evaluateCommon as previousEvaluate,
  commonObservationSpec,
  checkCommonObservation,
} from "./study-adapters-v4.ts";
import type {
  CommonTask,
  CommonTaskId,
  CommonSuite,
} from "./study-adapters-v4.ts";
import type { StudyRemote } from "./study-execution.ts";
export type {
  CommonTask,
  CommonTaskId,
  CommonArm,
  CommonSuite,
} from "./study-adapters-v4.ts";
export {
  commonContractSchema,
  commonFactsPacket,
  checkCommonContract,
  commonSuites,
  evaluateAlreadyCorrect,
  missingControlAssessment,
} from "./study-adapters-v4.ts";
export const commonTaskIds = [
  "dlv-null-path",
  "dset-decimal-path",
  "mri-zero-number",
] as const;
export function publicFalsyChallenges() {
  return z
    .strictObject({
      format: z.literal("repolab-public-falsy-challenges/v5"),
      origin: z.literal(
        "authored-exposed-development-from-v4-false-acceptance",
      ),
      cases: z
        .array(
          z.strictObject({
            id: z.string(),
            args: z.array(z.unknown()).min(2).max(3),
            expected: z.string(),
          }),
        )
        .length(12),
    })
    .parse(
      JSON.parse(
        readFileSync("evaluation/study-v5-falsy-challenges.json", "utf8"),
      ),
    ).cases;
}
export function commonTask(id: CommonTaskId): CommonTask {
  const t = previousTask(id);
  if (commonTaskIds.includes(id as (typeof commonTaskIds)[number]))
    t.origin = "exposed-public-historical-v4-model-attempted-authored-oracle";
  return id === "dlv-null-path"
    ? { ...t, challenge: [...t.challenge, ...publicFalsyChallenges()] }
    : t;
}
function identity(p: any) {
  const { id, expected, sourceQuote, description, ...input } = p;
  return JSON.stringify(input);
}
export function commonIndependent(id: CommonTaskId) {
  const t = commonTask(id),
    excluded = new Set([...t.core, ...t.challenge].map(identity));
  const cases = previousIndependent(id).filter(
    (p) => !excluded.has(identity(p)),
  );
  if (t.kind === "bug" && !cases.length) throw Error("Independent suite empty");
  return cases;
}
export async function evaluateCommon(
  t: CommonTask,
  source: string,
  suite: CommonSuite,
  image: string,
  run: StudyRemote,
  treeDigest?: string,
) {
  if (suite !== "independent")
    return previousEvaluate(t, source, suite, image, run, treeDigest);
  const probes = commonIndependent(t.id),
    spec = commonObservationSpec(t, source, probes),
    out = await run(image, spec),
    rows = checkCommonObservation(t, source, probes, out.execution, image);
  return { passed: rows.every((p) => p.passed), rows, detail: null };
}
