import ts from "typescript";
import { z } from "zod";
import { trialProposalSchema as sourceProposalSchema } from "../evaluation/preact-trial-v4.ts";
import { admitPreactEdit, preactRepairContext } from "./preact-admission-v5.ts";
import { preactAdmissionFeedback } from "./preact-diagnostics-v2.ts";
import { admissionObservations } from "../evaluation/preact-admission-v5.ts";

export const lifecyclePlanSchema = z.strictObject({
  requirementQuote: z.string().min(24).max(400),
  editBoundary: z.literal("existing-applyRef-try-body-only"),
  cleanupDisposal: z.enum([
    "invoke-before-callback",
    "invoke-after-callback",
    "omit",
  ]),
  nullCallbackWhenCleanup: z.enum(["skip", "invoke"]),
  legacyDisposal: z.enum(["invoke-null", "skip"]),
  callbackReturn: z.enum(["store-if-callable", "ignore"]),
  cleanupStateAfterCall: z.enum(["clear-to-undefined", "retain"]),
  objectRef: z.enum(["assign-current", "ignore"]),
  revisionGoal: z.string().min(1).max(500),
});
export const plannedProposalSchema = z.strictObject({
  plan: lifecyclePlanSchema,
  ...sourceProposalSchema.shape,
});
export function preactSourceProposal(value: unknown) {
  const { plan, ...source } = plannedProposalSchema.parse(value);
  if (!preactRepairContext().problemStatement.includes(plan.requirementQuote))
    throw Error("Plan quote is not an exact original report span");
  return source;
}
/** Metadata supplies no source privileges. Every assembled byte uses the unchanged policy. */
export function admitPlannedPreactEdit(value: unknown) {
  return admitPreactEdit(preactSourceProposal(value));
}
export function plannedAdmissionFeedback(value: unknown, reason: string) {
  const proposal = plannedProposalSchema.parse(value);
  let actual: string | null = null;
  try {
    admitPlannedPreactEdit(proposal);
  } catch (e) {
    actual = (e as Error).message;
  }
  if (
    (actual !== null && reason !== actual) ||
    (actual === null && reason !== "Unchanged or repeated scoped candidate")
  )
    throw Error("Planning feedback must match the authoritative rejection");
  const { plan, ...source } = proposal;
  const feedback =
    reason === "Plan quote is not an exact original report span"
      ? {
          kind: "admission",
          reason,
          correction:
            "Quote a contiguous span of the selected original problem statement. Invented requirements are not admitted.",
        }
      : preactAdmissionFeedback(source, reason);
  return {
    ...feedback,
    plan,
    editBoundary:
      "Return only statements inside the existing applyRef try body. Do not emit try/catch, options or an error handler.",
    planAuthority:
      "advisory claim; original source admission and native/public gates remain authoritative",
  };
}
export function preactPlanningGuidance() {
  const original = preactRepairContext(),
    quote = "return a cleanup function to reset";
  if (!original.problemStatement.includes(quote))
    throw Error("Original cleanup report quote changed");
  const source = original.sourceSlots.applyRef;
  if (!source.includes("try {") || !source.includes("catch (e)"))
    throw Error("Original applyRef error wrapper changed");
  return {
    origin:
      "selected original report, original applyRef source, and unchanged scoped editing policy",
    requirement: { quote, source: "problemStatement" },
    editBoundary: {
      source: "src/diff/index.js: applyRef",
      suppliedByController:
        "original function signature and try/catch error routing",
      modelSupplies: "statements inside the existing try block only",
      excluded: ["try", "catch", "options", "error-handler calls"],
    },
    checklist: [
      "Plan existing-cleanup disposal separately from legacy disposal with no cleanup.",
      "When stored cleanup handles disposal, invoke it before any callback invocation and avoid calling that ref with null on the same branch.",
      "Keep the original null callback for legacy callback refs; keep assigning object ref.current.",
      "Store callable mount results as per-VNode cleanup state and clear consumed state to undefined.",
      "On retry, describe the actual prior failure and change source accordingly; editing plan metadata alone is still a repeated candidate.",
    ],
    authority:
      "plan choices and prose are advisory; neither proves implementation or passes verification",
  };
}
const publicExpected = [
  { id: "returned-cleanup", events: ["mount", "cleanup"] },
  { id: "legacy-callback", events: ["mount", "null"] },
  { id: "object-ref", events: ["INPUT", "cleared"] },
];
const rowSchema = z.strictObject({
  id: z.string().min(1).max(80),
  events: z.array(z.string().max(100)).max(12),
  observedError: z.string().min(1).max(400).optional(),
});
const feedbackSchema = z.strictObject({
  kind: z.literal("public"),
  stage: z.enum(["public-A", "public-B"]),
  origin: z.literal(
    "unchanged public report checks; controller comparison of actual Sandbox observations",
  ),
  binding: z.strictObject({
    sourceHash: z.string().regex(/^[a-f0-9]{64}$/),
    operationId: z.uuid(),
    image: z.uuid(),
    receiptHash: z.string().regex(/^[a-f0-9]{64}$/),
  }),
  observations: z.strictObject({
    total: z.number(),
    passed: z.number(),
    failed: z.array(z.string()),
    rows: z.array(rowSchema),
  }),
  failures: z.array(
    z.strictObject({
      id: z.string(),
      expectedEvents: z.array(z.string()),
      actualEvents: z.array(z.string()),
      observedError: z.string().optional(),
    }),
  ),
});
/** Parse/compare only. Operation authenticity is separately established by trial raw replay. */
export function preactRecoveryReview(previous: unknown) {
  if (previous === null) return null;
  const prior = z
    .strictObject({ proposal: z.unknown(), feedback: z.unknown() })
    .parse(previous);
  const kind = z
    .enum(["admission", "native", "public"])
    .parse((prior.feedback as { kind?: unknown })?.kind);
  if (kind !== "public") {
    if (
      kind === "native" &&
      ![
        "build",
        "lint",
        "mocha-A",
        "mocha-B",
        "types",
        "browser-A",
        "browser-B",
      ].includes((prior.feedback as { stage: string }).stage)
    )
      throw Error(
        "Independent or unknown stages cannot supply recovery guidance",
      );
    return {
      kind,
      instruction:
        "Read the actual rejection and edit boundary. Fix source, preserve callable guards, and do not repeat prior assembled bytes.",
    };
  }
  const feedback = feedbackSchema.parse(prior.feedback);
  const source = (prior.proposal as { plan?: unknown })?.plan
    ? preactSourceProposal(prior.proposal)
    : sourceProposalSchema.parse(prior.proposal);
  if (admitPreactEdit(source).sourceHash !== feedback.binding.sourceHash)
    throw Error("Recovery feedback source binding changed");
  if (
    admissionObservations(publicExpected, "public").passed !==
    publicExpected.length
  )
    throw Error("Public expectation registry changed");
  const observations = admissionObservations(
    feedback.observations.rows,
    "public",
  );
  const failures = observations.rows.flatMap((row, i) =>
    observations.failed.includes(row.id)
      ? [
          {
            id: row.id,
            expectedEvents: publicExpected[i].events,
            actualEvents: row.events,
            ...(row.observedError ? { observedError: row.observedError } : {}),
          },
        ]
      : [],
  );
  if (
    !failures.length ||
    JSON.stringify(observations) !== JSON.stringify(feedback.observations) ||
    JSON.stringify(failures) !== JSON.stringify(feedback.failures)
  )
    throw Error("Recovery failures differ from controller public comparison");
  const prefix = "function view(ref,value,vnode,refVNode){";
  const file = ts.createSourceFile(
    "candidate.js",
    prefix + source.applyRefBody + "}",
    ts.ScriptTarget.ES2023,
    true,
    ts.ScriptKind.JS,
  );
  const callLocations: { call: string; offset: number }[] = [];
  const visit = (n: ts.Node) => {
    if (
      ts.isCallExpression(n) &&
      ["ref", "cleanup"].includes(n.expression.getText(file))
    )
      callLocations.push({
        call: n.getText(file),
        offset: n.getStart(file) - prefix.length,
      });
    ts.forEachChild(n, visit);
  };
  visit(file);
  return {
    kind,
    binding: feedback.binding,
    failures,
    callLocations,
    locationAuthority:
      "syntactic positions only; no execution or proof of path order",
    instruction:
      "Compare each failed expected/actual sequence. If null appears before cleanup but is absent from expected events, separate cleanup-handled disposal from legacy null-callback handling before invoking ref. Change assembled source; repeating the same source cannot recover.",
  };
}
