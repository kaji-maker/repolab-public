import { readFileSync } from "node:fs";
import { z } from "zod";
import { shaNative } from "./preact-native-v5.ts";
import {
  programProposalSchema,
  compileGeneratedProposal,
} from "../repositories/preact-generation-v2.ts";
import { preactPlanningGuidance } from "../repositories/preact-planning-v1.ts";
import { requestPolicyParameters } from "../providers/request-policy.ts";
import { auditTrialFreeze as auditPreviousTrialFreeze } from "./preact-trial-v7.ts";
export const PROBE_FREEZE = "29eb73a7472868c462bf1d8afd8fc3c1c25ec496a690d312ab9f0b029baa8670";
export const probeAssets = [
  "packages/evaluation/preact-nested-schema-v1.ts",
  "apps/evaluator/preact-nested-schema-v1.ts",
  "tests/preact-nested-schema-v1.test.ts",
  "packages/repositories/preact-generation-v2.ts",
  "tests/preact-generation-v2.test.ts",
  "evaluation/PREACT_NESTED_SCHEMA_V1.md",
  "packages/providers/nebius.ts",
  "packages/providers/diagnostics.ts",
  "packages/providers/request-policy.ts",
  "packages/storage/store.ts",
  "packages/storage/reconciliation.ts",
  "packages/repositories/repair-lease.ts",
  "evaluation/preact-trial-v7.json",
  "evaluation/preact-trial-v7-results-summary.json",
  "packages/evaluation/preact-trial-v7.ts",
];
export const probeSettings = {
  format: "repolab-preact-nested-schema/v1",
  model: "nvidia/nemotron-3-super-120b-a12b",
  baseUrl: "https://api.tokenfactory.nebius.com/v1/",
  rates: { input: 0.3, output: 0.9 },
  requestPolicy: "nemotron-low-effort-v1",
  maxCalls: 1,
  maxOperations: 0,
  monetaryCap: null,
};
export const probeSystem =
  "This is a schema compatibility check, not a repair task. Return the exact supplied metadata and toy nested program in the required JSON schema. Do not infer a cleanup implementation, execute code or add instructions. The program is the original legacy callback/object branch only, intentionally without cleanup behavior.";
export function probeExpected() {
  return {
    plan: {
      requirementQuote: preactPlanningGuidance().requirement.quote,
      editBoundary: "existing-applyRef-try-body-only",
      cleanupDisposal: "omit",
      nullCallbackWhenCleanup: "invoke",
      legacyDisposal: "invoke-null",
      callbackReturn: "ignore",
      cleanupStateAfterCall: "retain",
      objectRef: "assign-current",
      revisionGoal:
        "Schema-only legacy-ref toy; not a cleanup repair or correctness claim.",
    },
    taskId: "preactjs__preact-4436",
    refUpdates: "transfer-cleanup",
    unmountContext: "vnode",
    cleanupType: true,
    program: [
      {
        kind: "if",
        condition: "ref-function",
        then: [{ kind: "action", action: "call-ref" }],
        else: [{ kind: "action", action: "set-object" }],
      },
    ],
  };
}
export function probeContext() {
  return {
    purpose:
      "Recursive nested schema compatibility only; no candidate execution or repair selection",
    expected: probeExpected(),
    schema: z.toJSONSchema(programProposalSchema),
  };
}
export function probeRequest() {
  return {
    model: probeSettings.model,
    messages: [
      { role: "system", content: probeSystem },
      { role: "user", content: JSON.stringify(probeContext()) },
    ],
    max_tokens: 4096,
    ...requestPolicyParameters("nemotron-low-effort-v1", probeSettings.model),
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "preact_nested_schema_probe_v1",
        strict: true,
        schema: z.toJSONSchema(programProposalSchema),
      },
    },
  };
}
export function validateProbeReply(value: unknown) {
  const reply = programProposalSchema.parse(value),
    expected = programProposalSchema.parse(probeExpected());
  if (JSON.stringify(reply) !== JSON.stringify(expected))
    throw Error("Schema probe did not return the exact structural toy");
  const compiled = compileGeneratedProposal(reply);
  return {
    format: "repolab-preact-nested-schema-qualification/v1",
    schemaHash: shaNative(
      JSON.stringify(z.toJSONSchema(programProposalSchema)),
    ),
    compiledBodyHash: shaNative(compiled.applyRefBody),
    support:
      "Exact recursive schema accepted with a matching complete reply; no general schema or repair quality claim",
    inference: "nebius",
    execution: "none (schema check and syntax compilation only)",
  };
}
export function probeBytes(path: string) {
  const b = readFileSync(path);
  return path === probeAssets[0]
    ? Buffer.from(b.toString("utf8").replace(PROBE_FREEZE, "__PROBE_FREEZE__"))
    : b;
}
export function auditProbeFreeze(reader = probeBytes) {
  auditPreviousTrialFreeze();
  const p = JSON.parse(
    readFileSync("evaluation/preact-nested-schema-v1.json", "utf8"),
  );
  const { digest, assets, requestHash, ...settings } = p;
  if (
    digest !== PROBE_FREEZE ||
    shaNative(JSON.stringify({ ...settings, requestHash, assets })) !==
      digest ||
    JSON.stringify(settings) !== JSON.stringify(probeSettings) ||
    requestHash !== shaNative(JSON.stringify(probeRequest())) ||
    assets.length !== probeAssets.length ||
    assets.some(
      (a: { path: string; sha256: string }, i: number) =>
        a.path !== probeAssets[i] || a.sha256 !== shaNative(reader(a.path)),
    )
  )
    throw Error("Nested schema probe freeze changed");
  return p;
}
