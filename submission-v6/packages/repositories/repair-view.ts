import { z } from "zod";

export const RepairStartSchema = z.strictObject({
  profile: z.literal("clsx-object-push"),
});
export const repairActiveStatuses = new Set([
  "ADMITTING",
  "QUALIFYING_ORIGINAL",
  "EXTRACTING_CONTRACT",
  "REPAIRING",
  "STAGING_CANDIDATE",
  "FRESH_VERIFICATION",
  "INDEPENDENT_EVALUATION",
]);
const strings = (values: Record<string, string | undefined>) =>
  Object.values(values).filter((v): v is string => Boolean(v));

export interface RepairReview {
  format: "repolab-repository-review/v1";
  id: string;
  profile: "clsx-object-push";
  status: string;
  startedAt: string;
  completedAt?: string;
  failedStage?: string;
  success: boolean;
  active: boolean;
  provenance: { inference: string; execution: string; model?: string };
  scope: string;
  report?: string;
  protocolDigest?: string;
  snapshotDigest?: string;
  originalSourceHash?: string;
  core?: { tests: string; hash: string; expectationsHash: string };
  candidates: {
    attempt: number;
    sourceHash: string;
    source: string;
    accepted: boolean;
    gates: { name: string; passed: boolean; detail: string }[];
  }[];
  decision?: {
    attempt: number | null;
    accepted: boolean;
    sourceHash: string | null;
    at: string;
    sha256: string;
  };
  selectionIntegrity: boolean;
  evaluation?: {
    passed: number | null;
    total: number;
    valid: boolean;
    caseFileHash: string;
    openedAt: string;
  };
  executions: {
    id: string;
    operationId?: string;
    sourceHash: string;
    testHash: string;
    runtimeVersion?: string;
    exitCode: number | null;
    timedOut: boolean;
    truncated: boolean;
  }[];
  inferenceCalls: number;
  usageComplete: boolean;
  estimatedInferenceUsd: number;
  costProvenance: string;
  limits: {
    candidates: number;
    inferenceCalls: number;
    inferenceUsd: number;
    sandboxOperations: number;
  };
  error?: string;
  clarification?: string;
}

/** Whitelist browser evidence; never expose preparation paths, raw replies or headers. */
export function repairSummary(
  record: Record<string, any>,
  secrets: string[] = [],
) {
  const executions = [
    ...(record.originalExecutions ?? []),
    ...(record.candidates ?? []).flatMap((c: any) => c.executions ?? []),
    ...(record.independent?.execution ? [record.independent.execution] : []),
  ];
  const view: RepairReview = {
    format: "repolab-repository-review/v1" as const,
    id: record.id as string,
    profile: "clsx-object-push" as const,
    status: record.status as string,
    startedAt: record.startedAt as string,
    completedAt: record.completedAt as string | undefined,
    failedStage: record.failedStage as string | undefined,
    success: record.success === true,
    active: repairActiveStatuses.has(record.status),
    provenance: {
      inference: record.inferenceRequestsAttempted > 0 ? "nebius" : "none",
      execution: executions.length > 0 ? "nebius-sandbox" : "none",
      model: record.model as string | undefined,
    },
    scope:
      "One exposed historical development task; no held-out or comparison claim",
    report: record.report as string | undefined,
    protocolDigest: record.protocolDigest as string | undefined,
    snapshotDigest: record.snapshotDigest as string | undefined,
    originalSourceHash: record.originalSourceHash as string | undefined,
    core: record.core
      ? {
          tests: record.core.tests,
          hash: record.core.hash,
          expectationsHash: record.core.expectationsHash,
        }
      : undefined,
    candidates: (record.candidates ?? []).map((c: any) => ({
      attempt: c.attempt as number,
      sourceHash: c.sourceHash as string,
      source: c.patch?.content as string,
      accepted: c.accepted === true,
      gates: (c.gates ?? []).map((g: any) => ({
        name: g.name as string,
        passed: g.passed === true,
        detail: g.detail as string,
      })),
    })),
    decision: record.decision
      ? {
          attempt: record.decision.attempt,
          accepted: record.decision.accepted === true,
          sourceHash: record.decision.sourceHash,
          at: record.decision.at,
          sha256: record.decision.sha256,
        }
      : undefined,
    selectionIntegrity: record.selectionIntegrity === true,
    evaluation: record.independent
      ? {
          passed: record.independent.passed,
          total: record.independent.total,
          valid: record.independent.valid === true,
          caseFileHash: record.independent.caseFileHash,
          openedAt: record.independentOpenedAt,
        }
      : undefined,
    executions: executions.map((e: any) => ({
      id: e.id,
      operationId: e.operationId,
      sourceHash: e.sourceHash,
      testHash: e.testHash,
      runtimeVersion: e.runtimeVersion,
      exitCode: e.exitCode,
      timedOut: e.timedOut === true,
      truncated: e.truncated === true,
    })),
    inferenceCalls: record.inferenceCalls ?? record.usage?.length ?? 0,
    usageComplete: record.usageComplete === true,
    estimatedInferenceUsd:
      record.estimatedInferenceUsd ??
      (record.usage ?? []).reduce((n: number, u: any) => n + u.costUsd, 0),
    costProvenance:
      "Configured inference estimate; sandbox resource units are not USD",
    limits: {
      candidates: 2,
      inferenceCalls: 6,
      inferenceUsd: 0.1,
      sandboxOperations: 24,
    },
    error: record.error
      ? "Workflow stopped. Review its retained stage and evidence; no automatic retry."
      : undefined,
    clarification: record.clarification as string | undefined,
  };
  // Defense in depth even when a source proposal or remote gate echoes a credential.
  const scrub = (v: any): any =>
    typeof v === "string"
      ? secrets.reduce(
          (s, secret) => (secret ? s.replaceAll(secret, "[redacted]") : s),
          v,
        )
      : Array.isArray(v)
        ? v.map(scrub)
        : v && typeof v === "object"
          ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, scrub(x)]))
          : v;
  return scrub(view) as typeof view;
}
export function providerSecrets() {
  return strings({
    key: process.env.NEBIUS_API_KEY,
    token: process.env.NEBIUS_SANDBOX_TOKEN,
    sandboxKey: process.env.NEBIUS_SANDBOX_API_KEY,
  });
}
