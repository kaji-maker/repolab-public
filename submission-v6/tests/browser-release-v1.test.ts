import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { browserPolicy, validateBrowserAdmission, validateOwnedBrowserClaim, claimBrowserSlot,
  queuedBrowserRecord, withQueuedBrowserRecord } from "../packages/evaluation/browser-release-v1.ts";
const admission = () => ({ ...browserPolicy, id: randomUUID(), authorization: "Synthetic owner browser qualification authorization", inference: "none; fixture", execution: "controller metadata fixture only" });
const facts = () => ({ engineFreeze: browserPolicy.engineFreeze, workbenchFreeze: browserPolicy.workbenchFreeze,
  workbenchQualified: true, previousCliVerified: true, previousCliConsumed: true, previousCliReviewed: true,
  reconciliationStatus: "RECONCILED_CURRENT_ABSENCE_UNQUALIFIED", rawUploadStatus: "UNKNOWN", historicalRejectionAttested: false, billingConfirmed: false,
  leasesPresent: false, unresolvedExecution: false, unsettledCharges: 0, slotStarted: false, runExists: false, cohortUntouched: true });
test("Synthetic browser admission binds exactly one fresh API workflow", () => {
  const result = validateBrowserAdmission(admission(), facts());
  assert.equal(result.status, "ADMITTED_ONE_BROWSER_QUALIFICATION"); assert.equal(result.cloudLiveDispatchAllowed, false);
});
const cases: [string, (a: any, f: any) => void][] = [
  ["different action", a => { a.action = "RESUME"; }], ["missing authorization", a => { a.authorization = ""; }],
  ["extra source", a => { a.source = "return true"; }], ["wrong UUID", a => { a.id = "../prior"; }],
  ["more workflows", a => { a.workflowSlots = 2; }], ["more model calls", a => { a.maxCalls = 4; }],
  ["more candidates", a => { a.maxCandidates = 4; }], ["more operations", a => { a.maxOperations = 35; }],
  ["changed monetary policy", a => { a.monetaryCap = 1; }], ["wrong model", a => { a.model = "other"; }],
  ["wrong task", a => { a.taskId = "vue"; }], ["CLI instead of API", a => { a.entrypoint = "cli"; }],
  ["headless direct HTTP instead of browser driver", a => { a.driver = "http"; }],
  ["retry", a => { a.retries = 1; }], ["resume", a => { a.resumeConsumedWorkflow = true; }],
  ["changed study", a => { a.changeEightTaskStudy = true; }], ["new benchmark", a => { a.newBenchmarkSample = true; }],
  ["independent feedback", a => { a.independentFeedback = true; }], ["disabled admission", a => { a.executionAdmission = false; }],
  ["controller guest execution", a => { a.controllerGuestExecution = true; }], ["historical timestamp rewrite", a => { a.backfillHistoricalTimestamps = true; }],
  ["cloud permission", a => { a.cloudLiveDispatchAllowed = true; }],
  ["changed engine policy", a => { a.engineFreeze = "other"; }], ["changed UI policy", a => { a.workbenchFreeze = "other"; }],
  ["unfrozen engine", (_a, f) => { f.engineFreeze = "other"; }], ["unfrozen workbench", (_a, f) => { f.workbenchFreeze = "other"; }],
  ["unqualified workbench", (_a, f) => { f.workbenchQualified = false; }],
  ["unverified CLI predecessor", (_a, f) => { f.previousCliVerified = false; }],
  ["unconsumed CLI predecessor", (_a, f) => { f.previousCliConsumed = false; }],
  ["unreviewed CLI predecessor", (_a, f) => { f.previousCliReviewed = false; }],
  ["missing reconciliation", (_a, f) => { f.reconciliationStatus = "UNKNOWN"; }],
  ["promoted upload", (_a, f) => { f.rawUploadStatus = "VERIFIED"; }],
  ["invented rejection", (_a, f) => { f.historicalRejectionAttested = true; }],
  ["invented billing", (_a, f) => { f.billingConfirmed = true; }],
  ["held lease", (_a, f) => { f.leasesPresent = true; }], ["unknown operation", (_a, f) => { f.unresolvedExecution = true; }],
  ["unsettled charge", (_a, f) => { f.unsettledCharges = 1; }], ["consumed browser slot", (_a, f) => { f.slotStarted = true; }],
  ["existing run", (_a, f) => { f.runExists = true; }], ["changed old data", (_a, f) => { f.cohortUntouched = false; }],
];
for (const [name, mutate] of cases) test("Synthetic browser refusal: " + name, () => {
  const a = admission(), f = facts(); mutate(a, f); assert.throws(() => validateBrowserAdmission(a, f));
});
test("Browser claim survives failure/restart and never overwrites its first bytes", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "repolab-browser-claim-"));
  try {
    const file = path.join(root, "STARTED.json"), owner = { id: randomUUID(), fixture: true };
    claimBrowserSlot(file, owner); const bytes = fs.readFileSync(file);
    assert.throws(() => { throw Error("Synthetic final preflight failure"); });
    assert.throws(() => claimBrowserSlot(file, owner));
    assert.deepEqual(fs.readFileSync(file), bytes);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
test("Only an exact owned claim can continue remaining pre-dispatch gates", () => {
  const a = admission(), f = { ...facts(), slotStarted: true }, owner = { id: a.id, freeze: "fixture-freeze" };
  assert.equal(validateOwnedBrowserClaim(a, f, owner, owner).id, a.id);
  assert.throws(() => validateOwnedBrowserClaim(a, f, { ...owner, id: randomUUID() }, owner));
  const other = { ...owner, id: randomUUID() };
  assert.throws(() => validateOwnedBrowserClaim(a, f, other, other));
  assert.throws(() => validateOwnedBrowserClaim(a, { ...f, unsettledCharges: 1 }, owner, owner));
  assert.throws(() => validateOwnedBrowserClaim(a, { ...f, runExists: true }, owner, owner));
  assert.throws(() => validateOwnedBrowserClaim(a, { ...f, slotStarted: false }, owner, owner));
});
test("Queued admission keeps the selected browser run visible without inventing execution or a proof badge", async () => {
  const id = randomUUID(), pending = queuedBrowserRecord(id, new Date().toISOString());
  const history = withQueuedBrowserRecord({ list: async () => [], get: async () => null,
    patch: async () => { throw Error("No raw verified patch"); } }, () => pending);
  assert.equal((await history.list())[0].id, id); assert.equal((await history.get(id))!.active, true);
  assert.equal(await history.get(randomUUID()), null);
  assert.equal(pending.verified, false); assert.equal(pending.patchAvailable, false);
  assert.equal(pending.inferenceCalls, 0); assert.equal(pending.executionCount, 0);
  await assert.rejects(() => history.patch(id));
});
test("A durable pre-execution rejection stays visible and cannot become accepted", async () => {
  const id = randomUUID(), pending = queuedBrowserRecord(id, new Date().toISOString(), "Synthetic preflight rejection");
  const history = withQueuedBrowserRecord({ list: async () => [pending], get: async () => pending,
    patch: async () => { throw Error("Unverified"); } }, () => pending);
  assert.equal((await history.list()).length, 1);
  assert.equal((await history.get(id))!.active, false); assert.equal(pending.status, "ERROR");
  assert.equal(pending.accepted, false); assert.equal(pending.usageComplete, true);
  await assert.rejects(() => history.patch(id));
});
