import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { releasePolicy, validateReleaseAdmission, reserveReleaseSlot } from "../packages/evaluation/live-release-v2.ts";

globalThis.fetch = async () => { throw Error("No network in synthetic release controls"); };
const admission = () => ({ ...releasePolicy, id: "96f09c50-7e18-4e9b-9baf-3f4aa70925f8",
  authorization: "Synthetic owner qualification authorization fixture", inference: "none; synthetic", execution: "synthetic metadata only" });
const facts = () => ({ engineFreeze: releasePolicy.engineFreeze,
  reconciliationStatus: "RECONCILED_CURRENT_ABSENCE_UNQUALIFIED", rawUploadStatus: "UNKNOWN",
  historicalRejectionAttested: false, billingConfirmed: false, leasesPresent: false,
  unresolvedExecution: false, unsettledCharges: 0, slotStarted: false, runExists: false, cohortUntouched: true, previousReleaseConsumed: true, previousReleaseReviewed: true, previousReleaseUnverified: true, terminalFixQualified: true, offlineFixLiveSlots: 0 });
test("Synthetic release envelope admits only the reviewed scoped workflow", () => {
  const out = validateReleaseAdmission(admission(), facts());
  assert.equal(out.status, "ADMITTED_ONE_V4_RELEASE_QUALIFICATION");
  assert.equal(out.newBenchmarkSample, false);
});
const cases: [string, (a: any, f: any) => void][] = [
  ["Historical timestamp backfill", a => { a.backfillHistoricalTimestamps = true; }],
  ["Old release not consumed", (_a, f) => { f.previousReleaseConsumed = false; }],
  ["Old release not reviewed", (_a, f) => { f.previousReleaseReviewed = false; }],
  ["Old failure promoted to verified", (_a, f) => { f.previousReleaseUnverified = false; }],
  ["Unqualified correction", (_a, f) => { f.terminalFixQualified = false; }],
  ["Offline fix grants live slot", (_a, f) => { f.offlineFixLiveSlots = 1; }],
  ["Changed monetary policy", a => { a.monetaryCap = 10; }],
  ["Browser dispatch", a => { a.entrypoint = "api"; }],
  ["Disabled execution admission", a => { a.executionAdmission = false; }],
  ["Different action", a => { a.action = "RESUME_VUE"; }],
  ["Missing authorization", a => { a.authorization = ""; }],
  ["Extra source override", a => { a.source = "candidate"; }],
  ["Wrong run identity", a => { a.id = "../prior"; }],
  ["More workflows", a => { a.workflowSlots = 2; }],
  ["More inference calls", a => { a.maxCalls = 4; }],
  ["More candidates", a => { a.maxCandidates = 4; }],
  ["More execution operations", a => { a.maxOperations = 35; }],
  ["Different model", a => { a.model = "other"; }],
  ["Different task", a => { a.taskId = "vuejs__core-11870"; }],
  ["Retries", a => { a.retries = 1; }],
  ["Consumed workflow resumption", a => { a.resumeConsumedWorkflow = true; }],
  ["Changed cohort", a => { a.changeEightTaskStudy = true; }],
  ["New benchmark claim", a => { a.newBenchmarkSample = true; }],
  ["Independent feedback", a => { a.independentFeedback = true; }],
  ["Controller guest execution", a => { a.controllerGuestExecution = true; }],
  ["Cloud live permission", a => { a.cloudLiveDispatchAllowed = true; }],
  ["Unfrozen engine", (_a, f) => { f.engineFreeze = "other"; }],
  ["Missing reconciliation", (_a, f) => { f.reconciliationStatus = "UNKNOWN"; }],
  ["Promoted raw upload", (_a, f) => { f.rawUploadStatus = "VERIFIED"; }],
  ["Invented historical rejection", (_a, f) => { f.historicalRejectionAttested = true; }],
  ["Invented settled billing", (_a, f) => { f.billingConfirmed = true; }],
  ["Held shared lease", (_a, f) => { f.leasesPresent = true; }],
  ["Unresolved job", (_a, f) => { f.unresolvedExecution = true; }],
  ["Unsettled inference", (_a, f) => { f.unsettledCharges = 1; }],
  ["Consumed release slot", (_a, f) => { f.slotStarted = true; }],
  ["Existing production run", (_a, f) => { f.runExists = true; }],
  ["Changed old evidence", (_a, f) => { f.cohortUntouched = false; }],
];
for (const [name, mutate] of cases) test("Synthetic refusal: " + name, () => {
  const a = admission(), f = facts(); mutate(a, f);
  assert.throws(() => validateReleaseAdmission(a, f));
});
test("Exclusive envelope creation refuses restart and preserves first bytes", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "repolab-release-slot-"));
  const p = path.join(root, "STARTED.json");
  reserveReleaseSlot(p, { fixture: true, first: true });
  const bytes = fs.readFileSync(p);
  assert.throws(() => reserveReleaseSlot(p, { fixture: true, second: true }));
  assert.deepEqual(fs.readFileSync(p), bytes);
});
