import { z } from "zod";
import { preactRepairContext } from "./preact-admission-v5.ts";
import {
  programProposalSchema as previousSchema,
  compileGeneratedProposal as previousCompile,
  admitGeneratedPreactEdit as previousAdmission,
  preactGenerationGuidance as previousGuidance,
} from "./preact-generation-v2.ts";
export {
  generationAdmissionFeedback,
  generationBodyDiagnostics,
  generationRecoveryReview,
} from "./preact-generation-v2.ts";

export const exactRequirementQuotes = [
  "return a cleanup function to reset",
  "it would be great to be able to use cleanup functions with callback refs.",
] as const;
const quoteSchema = z.enum(exactRequirementQuotes);
export const programProposalSchema = previousSchema.extend({
  plan: previousSchema.shape.plan.extend({ requirementQuote: quoteSchema }),
});
export function assertExactRequirementQuotes() {
  const report = preactRepairContext().problemStatement;
  if (exactRequirementQuotes.some((q) => !report.includes(q)))
    throw Error("Published exact requirement quote changed");
}
function validateQuote(value: unknown) {
  assertExactRequirementQuotes();
  quoteSchema.parse(
    (value as { plan?: { requirementQuote?: unknown } })?.plan
      ?.requirementQuote,
  );
}
export function compileGeneratedProposal(value: unknown) {
  validateQuote(value);
  // The inherited compiler bounds the tree before recursive parsing, rejects
  // duplicate capture across all arms and enforces lexical result scope.
  return previousCompile(value);
}
export function admitGeneratedPreactEdit(value: unknown) {
  validateQuote(value);
  return previousAdmission(value);
}
export function preactGenerationGuidance() {
  assertExactRequirementQuotes();
  return {
    ...previousGuidance(),
    exactRequirementQuotes: [...exactRequirementQuotes],
    quoteRule:
      "Choose plan.requirementQuote verbatim from exactRequirementQuotes; do not paraphrase or combine spans.",
    resultBinding:
      "At most ONE capture-result node in the ENTIRE serialized program, counting every nested then and else array. Mutually exclusive runtime branches still count separately. Capture inside one ref-function arm; use result only after that node in its arm or descendants. Other callback invocations use call-ref when appropriate; they do not declare result.",
    preflightChecklist: [
      "Count capture-result nodes recursively across every arm; the total must be zero or one.",
      "Never put one capture-result in then and another in else, or repeat it in two lifecycle branches.",
      "A result-function condition or store-result action requires the earlier capture in the same lexical arm or an enclosing arm.",
      "Fix tree structure before replying; controller admission will reject violations without rewriting them.",
    ],
  };
}
