import { commonTask as previousTask } from "./study-adapters-v6.ts";
import type { CommonTaskId, CommonTask } from "./study-adapters-v6.ts";
export type {
  CommonTaskId,
  CommonTask,
  CommonArm,
  CommonSuite,
} from "./study-adapters-v6.ts";
export {
  commonIndependent,
  commonContractSchema,
  commonFactsPacket,
  checkCommonContract,
  commonSuites,
  evaluateAlreadyCorrect,
  missingControlAssessment,
} from "./study-adapters-v6.ts";
export const commonTaskIds = ["dlv-null-path"] as const;
export function commonTask(id: CommonTaskId): CommonTask {
  if (id !== "dlv-null-path") throw Error("Task outside dlv revision");
  return {
    ...previousTask(id),
    origin: "exposed-public-historical-v5-model-attempted-authored-oracle",
  };
}
