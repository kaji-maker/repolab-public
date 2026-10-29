import { z } from "zod";
import { readFileSync } from "node:fs";
import { shaNative } from "./preact-native-v5.ts";
import {
  trialAssets as previousAssets,
  trialSettings as previousSettings,
  auditTrialFreeze as auditPreviousTrialFreeze,
  trialContext,
  trialSystem,
  trialProposalSchema,
  candidateStages,
  assertTrialNoCredentials,
} from "./preact-trial-v9.ts";
import { auditProbeFreeze } from "./preact-thinking-schema-v1.ts";
import {
  thinkingRequest,
  THINKING_POLICY,
} from "../providers/nebius-thinking-v1.ts";
export {
  trialContext,
  trialSystem,
  trialProposalSchema,
  candidateStages,
  assertTrialNoCredentials,
};
export const PREACT_TRIAL_FREEZE = "9a46c592b4538aec6ddf3ea7c9595a7d87ee23b5784a309817acaacf7f9a7bee";
export const trialAssets = [
  "packages/evaluation/preact-trial-v10.ts",
  "packages/execution/preact-trial-v10.ts",
  "apps/evaluator/preact-trial-v10.ts",
  "tests/preact-trial-v10.test.ts",
  "evaluation/PREACT_TRIAL_V10.md",
  "packages/providers/nebius-thinking-v1.ts",
  "tests/nebius-thinking-v1.test.ts",
  "packages/evaluation/preact-thinking-schema-v1.ts",
  "apps/evaluator/preact-thinking-schema-v1.ts",
  "tests/preact-thinking-schema-v1.test.ts",
  "evaluation/PREACT_THINKING_SCHEMA_V1.md",
  "evaluation/preact-thinking-schema-v1.json",
  "evaluation/preact-thinking-schema-v1-results-summary.json",
  "evaluation/preact-trial-v9.json",
  "evaluation/preact-trial-v9-results-summary.json",
  ...previousAssets,
];
export const trialSettings = {
  ...previousSettings,
  format: "repolab-preact-trial/v10",
  previousCompletedFreeze:
    "5e53d9f97290e001772074fb9b7da48eff34fb769529c09255b9b7747d33fd71",
  requestPolicy: THINKING_POLICY,
  maxOutputTokens: 16384,
  transportTimeoutMs: 180000,
  comparisonScope:
    "Prospective settings-bundle trial against historical v9; no randomized or causal superiority claim",
};
export function trialModelRequest(context: unknown) {
  return thinkingRequest(
    trialSettings.model,
    "preact_repair_v10",
    trialSystem,
    JSON.stringify(context),
    trialProposalSchema,
  );
}
export function validateTrialModelRequest(value: unknown, context: unknown) {
  if (JSON.stringify(value) !== JSON.stringify(trialModelRequest(context)))
    throw Error(
      "Model request differs from original-only frozen context/settings",
    );
  assertTrialNoCredentials(value);
}
export function trialBytes(path: string) {
  const b = readFileSync(path);
  return path === trialAssets[0]
    ? Buffer.from(
        b.toString("utf8").replace(PREACT_TRIAL_FREEZE, "__TRIAL_FREEZE__"),
      )
    : b;
}
export function auditTrialFreeze(reader = trialBytes) {
  auditPreviousTrialFreeze();
  auditProbeFreeze();
  const p = JSON.parse(
    readFileSync("evaluation/preact-trial-v10.json", "utf8"),
  );
  const { digest, assets, contextHash, systemHash, ...settings } = p;
  if (
    digest !== PREACT_TRIAL_FREEZE ||
    shaNative(
      JSON.stringify({ ...settings, contextHash, systemHash, assets }),
    ) !== digest ||
    JSON.stringify(settings) !== JSON.stringify(trialSettings) ||
    contextHash !== shaNative(JSON.stringify(trialContext(1))) ||
    systemHash !== shaNative(trialSystem) ||
    assets.length !== trialAssets.length ||
    assets.some(
      (a: { path: string; sha256: string }, i: number) =>
        a.path !== trialAssets[i] || a.sha256 !== shaNative(reader(a.path)),
    )
  )
    throw Error("Preact full-thinking trial freeze changed");
  return p;
}

export function validateThinkingQualificationRawHashes(
  summary: unknown,
  reader: (name: string) => Buffer,
) {
  const p = z
    .object({
      rawFiles: z
        .array(
          z.strictObject({
            path: z.string(),
            sha256: z.string().regex(/^[a-f0-9]{64}$/),
          }),
        )
        .length(6),
    })
    .parse(summary);
  const expected = [
    "STARTED",
    "request",
    "completion",
    "diagnostic",
    "reply",
    "result",
  ].map((n) => n + ".json");
  for (let i = 0; i < expected.length; i++) {
    if (
      p.rawFiles[i].path !== expected[i] ||
      shaNative(reader(expected[i])) !== p.rawFiles[i].sha256
    )
      throw Error("Frozen qualification raw files changed");
  }
}
