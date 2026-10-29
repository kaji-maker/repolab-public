import { isDeepStrictEqual } from "node:util";
import { existsSync, writeFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { digest, regularBytes, requireRelease } from "./live-release-v1.ts";
export { digest, regularBytes, requireRelease };

export const RELEASE_ROOT = ".repolab/live-release-v2";
export const ENGINE_FREEZE = "2096c16f472d93957f5e4efc78b55e880d7261ae537d072dcef28748b20bff7a";
export const releasePolicy = {
  format: "repolab-live-release-admission/v2",
  action: "ONE_FRESH_PREACT_V4_RELEASE_QUALIFICATION",
  engineFreeze: ENGINE_FREEZE, taskId: "preactjs__preact-4436",
  model: "nvidia/nemotron-3-super-120b-a12b",
  workflowSlots: 1, maxCalls: 3, maxCandidates: 3, maxOperations: 34,
  monetaryCap: null, entrypoint: "cli", retries: 0,
  resumeConsumedWorkflow: false, changeEightTaskStudy: false,
  newBenchmarkSample: false, independentFeedback: false,
  executionAdmission: true, controllerGuestExecution: false,
  backfillHistoricalTimestamps: false, cloudLiveDispatchAllowed: false,
};
export const CONTROL_TESTS = 39;
const read = (p: string) => JSON.parse(regularBytes(p).toString());
export function validateReleaseAdmission(a: any, f: any) {
  const keys = [...Object.keys(releasePolicy), "id", "authorization", "inference", "execution"].sort();
  requireRelease(isDeepStrictEqual(Object.keys(a).sort(), keys), "Closed admission fields required");
  for (const [key, value] of Object.entries(releasePolicy))
    requireRelease(isDeepStrictEqual(a[key], value), "Release policy mismatch: " + key);
  requireRelease(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(a.id), "Bound v4 run identity required");
  requireRelease(typeof a.authorization === "string" && a.authorization.length > 20, "Owner runtime qualification authorization required");
  requireRelease(f.engineFreeze === ENGINE_FREEZE && f.reconciliationStatus === "RECONCILED_CURRENT_ABSENCE_UNQUALIFIED", "Reviewed engine and reconciliation required");
  requireRelease(f.rawUploadStatus === "UNKNOWN" && f.historicalRejectionAttested === false && f.billingConfirmed === false, "Historical upload evidence cannot be promoted");
  requireRelease(f.previousReleaseConsumed === true && f.previousReleaseReviewed === true && f.previousReleaseUnverified === true, "Previous release must remain consumed, reviewed and unverified");
  requireRelease(f.terminalFixQualified === true && f.offlineFixLiveSlots === 0, "Separate offline correction qualification required");
  requireRelease(f.leasesPresent === false && f.unresolvedExecution === false && f.unsettledCharges === 0, "Existing execution/accounting hold");
  requireRelease(f.slotStarted === false && f.runExists === false && f.cohortUntouched === true, "Consumed or changed workflow refused");
  return { status: "ADMITTED_ONE_V4_RELEASE_QUALIFICATION", id: a.id, maxCalls: 3, maxOperations: 34,
    newBenchmarkSample: false, cloudLiveDispatchAllowed: false };
}
export function verifyReleaseFreeze(expected: string) {
  const bytes = regularBytes(RELEASE_ROOT + "/freeze.json");
  requireRelease(/^[a-f0-9]{64}$/.test(expected) && digest(bytes) === expected, "Trusted release freeze mismatch");
  const freeze = JSON.parse(bytes.toString());
  requireRelease(freeze.action === releasePolicy.action && Object.keys(freeze.assets).length > 100, "Complete runtime source freeze required");
  for (const [p, sha] of Object.entries(freeze.assets))
    requireRelease(digest(regularBytes(p)) === sha, "Frozen runtime source/input changed: " + p);
  const prior = read(RELEASE_ROOT + "/prior-hashes.json");
  for (const [p, sha] of Object.entries(prior))
    requireRelease(digest(regularBytes(p)) === sha, "Prior private evidence changed: " + p);
  return { freeze, priorCount: Object.keys(prior).length };
}
export async function releaseFacts() {
  const a = read(RELEASE_ROOT + "/admission.json");
  const reconciliation = read(".repolab/prospective-vue-11870-current-absence-v1/completion.json");
  const raw = read(".repolab/prospective-vue-11870-v2/run/upload-manifest.json.json");
  regularBytes(".repolab/state.sqlite");
  const db = new DatabaseSync(".repolab/state.sqlite", { readOnly: true });
  let unsettledCharges: number;
  try { unsettledCharges = Number(db.prepare("SELECT COUNT(*) AS count FROM charges WHERE state != 'settled'").get()!.count); }
  finally { db.close(); }
  const previousRoot = ".repolab/live-release-v1";
  const previous = read(previousRoot + "/completion-audit.json");
  const previousResult = read(previousRoot + "/runtime-result.json");
  const previousStarted = read(previousRoot + "/STARTED.json");
  const previousHashes = read(previousRoot + "/run-record-hashes.json");
  requireRelease(previous.id === previousResult.id && previous.id === previousStarted.id && previous.id !== a.id, "Separate previous/fresh workflow identities required");
  for (const [p, sha] of Object.entries(previousHashes))
    requireRelease(digest(regularBytes(p)) === sha, "Previous runtime bytes changed: " + p);
  const fixRoot = ".repolab/preact-terminal-time-v1";
  const fix = read(fixRoot + "/audit-1.json");
  requireRelease(regularBytes(fixRoot + "/audit-1.json").equals(regularBytes(fixRoot + "/audit-2.json")) &&
    regularBytes(fixRoot + "/audit-1.json").equals(regularBytes("evaluation/preact-terminal-time-v1-results-summary.json")), "Correction audit/summary mismatch");
  const { auditFreshPreact } = await import("../repositories/preact-repair-protocol-v4.ts");
  const { unresolvedGuardedPreactExecution } = await import("../repositories/preact-repair-history-v3.ts");
  const engine = auditFreshPreact();
  const { trialSettings } = await import("./preact-reliability-v2.ts");
  requireRelease(engine.maxCalls === a.maxCalls && engine.maxCandidates === a.maxCandidates && engine.maxOperations === a.maxOperations &&
    trialSettings.maxCalls === a.maxCalls && trialSettings.maxCandidates === a.maxCandidates && trialSettings.maxOperations === a.maxOperations && trialSettings.model === a.model, "Inherited runtime ceilings/model changed");
  return { engineFreeze: engine.digest, reconciliationStatus: reconciliation.status,
    rawUploadStatus: raw.status, historicalRejectionAttested: reconciliation.historicalRejectionAttested,
    billingConfirmed: reconciliation.billingConfirmed,
    previousReleaseConsumed: previous.workflowConsumed === true && previousStarted.id === previous.id,
    previousReleaseReviewed: previous.status === "PASS_POST_RUN_INTEGRITY" && previous.allOperationGuardsTerminal === true &&
      previous.executionUncertain === false && previous.sharedLeasesPresent === 0 && previous.unsettledInferenceCharges === 0,
    previousReleaseUnverified: previousResult.status === "ERROR" && previousResult.error === "Invalid evidence timestamp" &&
      previous.runtimeQualified === false && previousResult.verified === false,
    terminalFixQualified: fix.status === "PASS_OFFLINE_ONLY" && fix.freeze === ENGINE_FREEZE && fix.syntheticGroupsPassed === 8 && fix.typecheck === "PASS",
    offlineFixLiveSlots: engine.newLiveQualificationSlots,
    leasesPresent: [".repolab/clsx-repair.lock", ".repolab/repositories/clsx-repair.lock"].some(existsSync),
    unresolvedExecution: unresolvedGuardedPreactExecution() || unresolvedGuardedPreactExecution(".repolab/native-preact-repairs-v4"),
    unsettledCharges, slotStarted: existsSync(RELEASE_ROOT + "/STARTED.json"),
    runExists: existsSync(".repolab/native-preact-repairs-v4/repair-" + a.id), cohortUntouched: true };
}
export function reserveReleaseSlot(path: string, value: unknown) {
  writeFileSync(path, JSON.stringify(value, null, 2) + "\n", { flag: "wx", mode: 0o600 });
}
