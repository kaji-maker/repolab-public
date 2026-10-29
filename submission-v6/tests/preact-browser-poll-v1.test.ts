import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { browserPollState } from "../packages/repositories/preact-browser-poll-v1.ts";
import { validateWorkbenchPins, workbenchAssets, workbenchBytes } from "../packages/repositories/preact-workbench-protocol-v2.ts";
const id = "submitted", other = { id: "older", active: false, status: "ACCEPTED_INDEPENDENTLY_CORRECT" };
test("Missing active row reproduces the old stop condition and remains pending in the new poll state", () => {
  const history = [other];
  assert.equal(history.some(r => r.active), false);
  assert.deepEqual(browserPollState(history, id), { awaiting: id, shouldPoll: true });
  assert.deepEqual(browserPollState([], id), { awaiting: id, shouldPoll: true });
});
test("Only the submitted identity's known terminal disposition clears polling", () => {
  for (const status of ["ACCEPTED_INDEPENDENTLY_CORRECT", "ACCEPTED_INDEPENDENTLY_INCORRECT", "ABSTAINED", "ERROR", "CANCELLED", "INTERRUPTED", "INVALID_REPAIR_EVIDENCE"])
    assert.deepEqual(browserPollState([other, { id, active: false, status }], id), { awaiting: null, shouldPoll: false });
  for (const record of [{ id, active: true, status: "REPAIRING" }, { id, active: false, status: "PREPARING" }, { id, active: true, status: "ERROR" }, { id: "foreign", active: false, status: "ERROR" }])
    assert.deepEqual(browserPollState([record], id), { awaiting: id, shouldPoll: true });
});
test("Read-only history stays idle and other active workflows retain refresh", () => {
  assert.deepEqual(browserPollState([other], null), { awaiting: null, shouldPoll: false });
  assert.deepEqual(browserPollState([{ id: "other", active: true, status: "REPAIRING" }], null), { awaiting: null, shouldPoll: true });
  assert.deepEqual(browserPollState([{ id, active: false, status: "ERROR" }, { id: "other", active: true, status: "REPAIRING" }], id), { awaiting: null, shouldPoll: true });
});
test("Polling fix source pins reject substitutions and live slot expansion", () => {
  const p = JSON.parse(readFileSync("evaluation/preact-workbench-v2.json", "utf8")); validateWorkbenchPins(p);
  for (const path of workbenchAssets) assert.throws(() => validateWorkbenchPins(p, x => x === path ? Buffer.from("changed") : workbenchBytes(x)));
  assert.throws(() => validateWorkbenchPins({ ...p, newLiveQualificationSlots: 1 }));
});
