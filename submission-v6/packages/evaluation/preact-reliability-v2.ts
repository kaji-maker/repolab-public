import { z } from "zod";
import {
  auditTrialFreeze as auditPrevious,
  trialSettings as previousSettings,
  trialContext as previousContext,
  trialSystem as previousSystem,
} from "./preact-trial-v10.ts";
import { auditProbeFreeze } from "./preact-thinking-schema-v2.ts";
import {
  programProposalSchema,
  preactGenerationGuidance,
  exactRequirementQuotes,
} from "../repositories/preact-generation-v3.ts";
import { thinkingRequest } from "../providers/nebius-thinking-v1.ts";
export {
  candidateStages,
  assertTrialNoCredentials,
  validateThinkingQualificationRawHashes,
} from "./preact-trial-v10.ts";
import { assertTrialNoCredentials } from "./preact-trial-v10.ts";

export const trialSettings = {
  ...previousSettings,
  format: "repolab-preact-reliability/v2",
};
export const trialProposalSchema = programProposalSchema;
export const trialSystem =
  previousSystem +
  " Choose plan.requirementQuote exactly from generationGuidance.exactRequirementQuotes. Before returning JSON, recursively count capture-result over the entire tree: zero or one node total, including all mutually exclusive then/else arms. Do not duplicate declarations across lifecycle branches or use result outside its capture scope. Controller rejection never rewrites your program.";
export function trialContext(attempt: number, previous: unknown = null) {
  const context = previousContext(attempt, previous);
  return {
    ...context,
    planningGuidance: {
      ...context.planningGuidance,
      exactRequirementQuotes: [...exactRequirementQuotes],
    },
    generationGuidance: preactGenerationGuidance(),
    providerSchema: z.toJSONSchema(programProposalSchema),
  };
}
export function trialModelRequest(context: unknown) {
  return thinkingRequest(
    trialSettings.model,
    "preact_repair_v2",
    trialSystem,
    JSON.stringify(context),
    trialProposalSchema,
  );
}
export function validateTrialModelRequest(value: unknown, context: unknown) {
  if (JSON.stringify(value) !== JSON.stringify(trialModelRequest(context)))
    throw Error(
      "Model request differs from exact-quote frozen context/settings",
    );
  assertTrialNoCredentials(value);
}
export function auditTrialFreeze() {
  auditPrevious();
  auditProbeFreeze();
}
