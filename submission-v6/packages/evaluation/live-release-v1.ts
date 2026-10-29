import { isDeepStrictEqual } from "node:util";
import { createHash } from "node:crypto";
import { existsSync, lstatSync, readFileSync, writeFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";

export const RELEASE_ROOT = ".repolab/live-release-v1";
export const ENGINE_FREEZE = "e50e387594890fcbcff387c1e1e95d90ea857b320105c8c765ecbd226a384449";
export const releasePolicy = {
  format: "repolab-live-release-admission/v1",
  action: "ONE_FRESH_PREACT_RELEASE_QUALIFICATION",
  engineFreeze: ENGINE_FREEZE,
  taskId: "preactjs__preact-4436",
  model: "nvidia/nemotron-3-super-120b-a12b",
  workflowSlots: 1, maxCalls: 3, maxCandidates: 3, maxOperations: 34,
  monetaryCap: null, entrypoint: "cli", retries: 0,
  resumeConsumedWorkflow: false, changeEightTaskStudy: false,
  newBenchmarkSample: false, independentFeedback: false,
  executionAdmission: true, controllerGuestExecution: false,
  cloudLiveDispatchAllowed: false,
};
export const digest = (b: string | Buffer) => createHash("sha256").update(b).digest("hex");
export function requireRelease(ok: unknown, reason: string): asserts ok {
  if (!ok) throw Error(reason);
}
export function regularBytes(p: string): Buffer {
  requireRelease(!p.startsWith("/") && p.split("/").every(x => x && x !== "." && x !== ".."), "Closed relative evidence path required");
  let cursor = ".";
  for (const part of p.split("/")) {
    cursor = join(cursor, part);
    requireRelease(!lstatSync(cursor).isSymbolicLink(), "Symlink evidence refused");
  }
  requireRelease(lstatSync(p).isFile(), "Regular evidence file required");
  return readFileSync(p);
}
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
  requireRelease(f.leasesPresent === false && f.unresolvedExecution === false && f.unsettledCharges === 0, "Existing execution/accounting hold");
  requireRelease(f.slotStarted === false && f.runExists === false && f.cohortUntouched === true, "Consumed or changed workflow refused");
  return { status: "ADMITTED_ONE_RELEASE_QUALIFICATION", id: a.id, maxCalls: 3, maxOperations: 34,
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
  const { auditFreshPreact } = await import("../repositories/preact-repair-protocol-v3.ts");
  const { unresolvedGuardedPreactExecution } = await import("../repositories/preact-repair-history-v3.ts");
  const engine = auditFreshPreact();
  const { trialSettings } = await import("./preact-reliability-v2.ts");
  requireRelease(engine.maxCalls === a.maxCalls && engine.maxCandidates === a.maxCandidates && engine.maxOperations === a.maxOperations && trialSettings.maxCalls === a.maxCalls && trialSettings.maxCandidates === a.maxCandidates && trialSettings.maxOperations === a.maxOperations && trialSettings.model === a.model, "Inherited runtime ceilings/model changed");
  return { engineFreeze: engine.digest, reconciliationStatus: reconciliation.status,
    rawUploadStatus: raw.status, historicalRejectionAttested: reconciliation.historicalRejectionAttested,
    billingConfirmed: reconciliation.billingConfirmed,
    leasesPresent: [".repolab/clsx-repair.lock", ".repolab/repositories/clsx-repair.lock"].some(existsSync),
    unresolvedExecution: unresolvedGuardedPreactExecution(), unsettledCharges,
    slotStarted: existsSync(RELEASE_ROOT + "/STARTED.json"),
    runExists: existsSync(".repolab/native-preact-repairs-v3/repair-" + a.id), cohortUntouched: true };
}
export function reserveReleaseSlot(path: string, value: unknown) {
  // Exclusive creation consumes the envelope even if later dispatch fails.
  writeFileSync(path, JSON.stringify(value, null, 2) + "\n", { flag: "wx", mode: 0o600 });
}
