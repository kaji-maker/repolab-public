import { isDeepStrictEqual } from "node:util";
import { existsSync, writeFileSync } from "node:fs";
import { digest, regularBytes, requireRelease } from "./live-release-v1.ts";
import { browserFacts as previousFacts } from "./browser-release-v1.ts";
import { validateWorkbenchPins } from "../repositories/preact-workbench-protocol-v2.ts";
import type { FreshPreactHistory } from "../repositories/preact-repair-history-v4.ts";
export { digest, regularBytes, requireRelease };
export const RELEASE_ROOT = ".repolab/browser-release-v2";
export const ENGINE_FREEZE = "2096c16f472d93957f5e4efc78b55e880d7261ae537d072dcef28748b20bff7a";
export const WORKBENCH_FREEZE = "520dfb352f7e42db88d0f25e6e343cb8655dcf0c690af4926a22712ab7640a7e";
export const browserPolicy = {
  format: "repolab-browser-release-admission/v2", action: "ONE_FRESH_PREACT_V4_FIXED_BROWSER_QUALIFICATION",
  engineFreeze: ENGINE_FREEZE, workbenchFreeze: WORKBENCH_FREEZE,
  taskId: "preactjs__preact-4436", model: "nvidia/nemotron-3-super-120b-a12b",
  workflowSlots: 1, maxCalls: 3, maxCandidates: 3, maxOperations: 34, monetaryCap: null,
  entrypoint: "api", driver: "browser", retries: 0, resumeConsumedWorkflow: false,
  changeEightTaskStudy: false, newBenchmarkSample: false, independentFeedback: false,
  executionAdmission: true, controllerGuestExecution: false, backfillHistoricalTimestamps: false,
  cloudLiveDispatchAllowed: false,
};
export const readBrowserRecord = (name: string) => {
  requireRelease(/^[a-z0-9-]+\.json$/.test(name), "Closed browser qualification record required");
  return JSON.parse(regularBytes(RELEASE_ROOT + "/" + name).toString());
};
export function validateBrowserAdmission(a: any, f: any) {
  requireRelease(isDeepStrictEqual(Object.keys(a).sort(), [...Object.keys(browserPolicy), "id", "authorization", "inference", "execution"].sort()), "Closed admission fields required");
  for (const [key, value] of Object.entries(browserPolicy)) requireRelease(isDeepStrictEqual(a[key], value), "Browser policy mismatch: " + key);
  requireRelease(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(a.id), "New bound v4 run identity required");
  requireRelease(typeof a.authorization === "string" && a.authorization.length > 20, "Owner browser qualification authorization required");
  requireRelease(f.engineFreeze === ENGINE_FREEZE && f.workbenchFreeze === WORKBENCH_FREEZE && f.workbenchQualified === true, "Qualified unchanged engine/workbench required");
  requireRelease(f.previousCliVerified === true && f.previousCliConsumed === true && f.previousCliReviewed === true, "Verified consumed CLI predecessor required");
  requireRelease(f.previousBrowserVerified === true && f.previousBrowserConsumed === true && f.previousBrowserObservationUnqualified === true && f.previousBrowserClosed === true, "Previous browser outcome must stay verified, consumed, observation-unqualified and closed");
  requireRelease(f.reconciliationStatus === "RECONCILED_CURRENT_ABSENCE_UNQUALIFIED" && f.rawUploadStatus === "UNKNOWN" && f.historicalRejectionAttested === false && f.billingConfirmed === false, "Historical reconciliation must remain unpromoted");
  requireRelease(f.leasesPresent === false && f.unresolvedExecution === false && f.unsettledCharges === 0, "Existing execution/accounting hold");
  requireRelease(f.slotStarted === false && f.runExists === false && f.cohortUntouched === true, "Consumed or changed workflow refused");
  return { status: "ADMITTED_ONE_BROWSER_QUALIFICATION", id: a.id, maxCalls: 3, maxOperations: 34, cloudLiveDispatchAllowed: false, newBenchmarkSample: false };
}
export function verifyBrowserFreeze(expected: string) {
  const bytes = regularBytes(RELEASE_ROOT + "/freeze.json");
  requireRelease(/^[a-f0-9]{64}$/.test(expected) && digest(bytes) === expected, "Trusted browser execution freeze mismatch");
  const freeze = JSON.parse(bytes.toString());
  requireRelease(freeze.action === browserPolicy.action && Object.keys(freeze.assets).length > 100, "Complete browser runtime freeze required");
  for (const [p, sha] of Object.entries(freeze.assets)) requireRelease(digest(regularBytes(p)) === sha, "Frozen browser source/input changed: " + p);
  const prior = readBrowserRecord("prior-hashes.json");
  for (const [p, sha] of Object.entries(prior)) requireRelease(digest(regularBytes(p)) === sha, "Historical private evidence changed: " + p);
  return { freeze, priorCount: Object.keys(prior).length };
}
export async function browserFacts() {
  const base = await previousFacts(), a = readBrowserRecord("admission.json");
  const previous = JSON.parse(regularBytes(".repolab/browser-release-v1/completion-audit.json").toString());
  const previousStarted = JSON.parse(regularBytes(".repolab/browser-release-v1/STARTED.json").toString());
  const hashes = JSON.parse(regularBytes(".repolab/browser-release-v1/run-record-hashes.json").toString());
  for (const [p, sha] of Object.entries(hashes)) requireRelease(digest(regularBytes(p)) === sha, "Previous browser runtime bytes changed: " + p);
  requireRelease(previous.id !== a.id && previous.id === previousStarted.id, "Separate fixed-browser identity required");
  const workbench = validateWorkbenchPins(JSON.parse(regularBytes("evaluation/preact-workbench-v2.json").toString()));
  requireRelease(workbench.parentWorkbenchFreeze === base.workbenchFreeze && workbench.parentEngineFreeze === base.engineFreeze, "Qualified parent workbench/engine required");
  const first = regularBytes(".repolab/preact-browser-poll-v1/audit-1.json");
  requireRelease(first.equals(regularBytes(".repolab/preact-browser-poll-v1/audit-2.json")) && first.equals(regularBytes("evaluation/preact-browser-poll-v1-results-summary.json")), "Polling correction qualification mismatch");
  const review = JSON.parse(first.toString());
  return { engineFreeze: base.engineFreeze, workbenchFreeze: workbench.freeze,
    workbenchQualified: review.status === "PASS_OFFLINE_POLL_FIX" && review.workbenchFreeze === WORKBENCH_FREEZE && review.controllerGroupsPassed === 4 && review.oldBrowserStopReproduced === true && review.fixedBrowserFixtureAutomaticTerminal === true && review.typecheck === "PASS" && review.productionBuild === "PASS" && review.defaultServerAdmission === false,
    previousCliVerified: base.previousCliVerified, previousCliConsumed: base.previousCliConsumed, previousCliReviewed: base.previousCliReviewed,
    previousBrowserVerified: previous.resultStatus === "ACCEPTED_INDEPENDENTLY_CORRECT" && previous.freshRepairVerified === true && previous.rawTerminalResultAudited === true && previous.allOperationGuardsTerminal === true && previous.executionUncertain === false && previous.sharedLeasesPresent === 0 && previous.unsettledInferenceCharges === 0,
    previousBrowserConsumed: previous.workflowConsumed === true,
    previousBrowserObservationUnqualified: previous.actualBrowserEndToEndQualified === false,
    previousBrowserClosed: JSON.parse(regularBytes(".repolab/browser-release-v1/server-closure-audit.json").toString()).status === "VERIFIED_LOCAL_SERVER_CLOSED",
    reconciliationStatus: base.reconciliationStatus, rawUploadStatus: base.rawUploadStatus, historicalRejectionAttested: base.historicalRejectionAttested, billingConfirmed: base.billingConfirmed,
    leasesPresent: base.leasesPresent, unresolvedExecution: base.unresolvedExecution, unsettledCharges: base.unsettledCharges,
    slotStarted: existsSync(RELEASE_ROOT + "/STARTED.json"), runExists: existsSync(".repolab/native-preact-repairs-v4/repair-" + a.id), cohortUntouched: true };
}
export function claimBrowserSlot(path: string, value: unknown) {
  writeFileSync(path, JSON.stringify(value, null, 2) + "\n", { flag: "wx", mode: 0o600 });
}
export function validateOwnedBrowserClaim(a: any, f: any, actual: unknown, owner: unknown) {
  requireRelease(f.slotStarted === true && (actual as any)?.id === a.id && (owner as any)?.id === a.id && isDeepStrictEqual(actual, owner), "Exact owned consumed browser envelope required");
  // Its own exclusive claim is expected here; all remaining pre-dispatch gates stay unchanged.
  return validateBrowserAdmission(a, { ...f, slotStarted: false });
}
export function queuedBrowserRecord(id: string, at: string, error: string | null = null): NonNullable<Awaited<ReturnType<FreshPreactHistory["get"]>>> {
  return { id, freeze: ENGINE_FREEZE, status: error ? "ERROR" : "PREPARING", verified: false, simulated: false,
    startedAt: at, completedAt: null, active: !error, failedStage: error ? "ADMISSION" : null, error,
    executionUncertain: false, recovery: null, inferenceCalls: 0, executionCount: 0, estimatedInferenceUsd: 0,
    usageComplete: true, provenance: { inference: "none (not yet dispatched)", execution: "none (waiting for controller preflight)", model: browserPolicy.model },
    sourceHash: null, accepted: false, candidates: [], native: null, public: null, independent: null,
    latestStage: "PREPARING", operationIds: [], patchAvailable: false, patchSha256: null,
    scope: "One exposed Preact feature; queued controller admission only, no guest execution yet" };
}
export function withQueuedBrowserRecord(history: Pick<FreshPreactHistory, "list" | "get" | "patch">, queued: () => ReturnType<typeof queuedBrowserRecord> | null) {
  return { list: async () => {
    const records = await history.list(), pending = queued();
    return pending && !records.some(r => r.id === pending.id) ? [pending, ...records] : records;
  }, get: async (id: string) => (await history.get(id)) ?? (() => { const p = queued(); return p?.id === id ? p : null; })(),
  patch: (id: string) => history.patch(id) };
}
