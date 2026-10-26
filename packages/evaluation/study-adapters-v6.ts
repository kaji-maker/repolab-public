import { readFileSync } from "node:fs";
import { z } from "zod";
import {
  commonTask as previousTask,
  commonIndependent as previousIndependent,
  evaluateCommon as previousEvaluate,
} from "./study-adapters-v5.ts";
import {
  commonObservationSpec,
  checkCommonObservation,
} from "./study-adapters-v4.ts";
import type {
  CommonTask,
  CommonTaskId,
  CommonSuite,
} from "./study-adapters-v5.ts";
import type { StudyRemote } from "./study-execution.ts";
export type {
  CommonTask,
  CommonTaskId,
  CommonArm,
  CommonSuite,
} from "./study-adapters-v5.ts";
export {
  commonContractSchema,
  commonFactsPacket,
  checkCommonContract,
  commonSuites,
  evaluateAlreadyCorrect,
  missingControlAssessment,
} from "./study-adapters-v5.ts";
export const commonTaskIds = ["mri-zero-number"] as const;
export function publicMriChallenges() {
  const data = z
    .strictObject({
      format: z.literal("repolab-public-mri-compatibility/v6"),
      origin: z.literal(
        "authored-exposed-development-from-v5-false-acceptance",
      ),
      cases: z
        .array(
          z.strictObject({
            id: z.string(),
            args: z.array(z.string()).max(64),
            options: z.record(z.string(), z.unknown()),
            expected: z.string(),
          }),
        )
        .length(16),
    })
    .parse(
      JSON.parse(
        readFileSync("evaluation/study-v6-mri-challenges.json", "utf8"),
      ),
    );
  if (new Set(data.cases.map((p) => p.id)).size !== data.cases.length)
    throw Error("Duplicate MRI compatibility identity");
  return data.cases;
}
export function commonTask(id: CommonTaskId): CommonTask {
  const t = previousTask(id);
  return id === "mri-zero-number"
    ? {
        ...t,
        origin: "exposed-public-historical-v5-model-attempted-authored-oracle",
        challenge: [...t.challenge, ...publicMriChallenges()],
      }
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
    spec = commonObservationSpec(t, source, probes);
  const out = await run(image, spec);
  const rows = checkCommonObservation(t, source, probes, out.execution, image);
  return { passed: rows.every((p) => p.passed), rows, detail: null };
}
