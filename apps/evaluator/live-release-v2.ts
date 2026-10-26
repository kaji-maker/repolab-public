import { existsSync } from "node:fs";
import {
  RELEASE_ROOT, digest, regularBytes, requireRelease, releaseFacts,
  reserveReleaseSlot, validateReleaseAdmission, verifyReleaseFreeze, CONTROL_TESTS,
} from "../../packages/evaluation/live-release-v2.ts";

const [mode, freezeSha, argument] = process.argv.slice(2);
const output = (name: string, value: unknown) => reserveReleaseSlot(RELEASE_ROOT + "/" + name, value);
const read = (name: string) => JSON.parse(regularBytes(RELEASE_ROOT + "/" + name).toString());
try {
  requireRelease(mode === "audit" || mode === "run", "Explicit audit/run required");
  const pinned = verifyReleaseFreeze(freezeSha), admission = read("admission.json");
  if (mode === "audit") globalThis.fetch = async () => { throw Error("Network forbidden in keyless audit"); };
  const facts = await releaseFacts(), decision = validateReleaseAdmission(admission, facts);
  if (mode === "audit") {
    requireRelease(argument === "audit-1.json" || argument === "audit-2.json", "Closed audit destination required");
    output(argument, { status: "PASS_KEYLESS_RELEASE_PLAN", freezeSha256: freezeSha, decision, facts,
      priorPrivateJsonFilesMatched: pinned.priorCount, inference: "none", execution: "Read-only saved-data/source/ledger audit; provider fetch forbidden" });
    console.log(JSON.stringify({ status: "PASS_KEYLESS_RELEASE_PLAN", priorPrivateJsonFilesMatched: pinned.priorCount }));
  } else {
    const planBytes = regularBytes(RELEASE_ROOT + "/dispatch-plan.json"), plan = JSON.parse(planBytes.toString());
    requireRelease(digest(planBytes) === argument && plan.freezeSha256 === freezeSha && plan.id === admission.id && plan.workflowSlots === 1 && plan.executionAdmission === true, "Reviewed single-use dispatch plan required");
    requireRelease(regularBytes(RELEASE_ROOT + "/audit-1.json").equals(regularBytes(RELEASE_ROOT + "/audit-2.json")), "Keyless plans differ");
    for (const name of ["audit-1.json", "audit-2.json", "controls-audit.json"]) {
      const b = regularBytes(RELEASE_ROOT + "/" + name), data = JSON.parse(b.toString());
      requireRelease(digest(b) === plan.qualificationHashes[name] && data.status.startsWith("PASS"), "Qualification record changed");
    }
    requireRelease(read("controls-audit.json").passedTests === CONTROL_TESTS && read("controls-audit.json").failedTests === 0, "Complete synthetic controls required");
    const { freshPreactReadiness } = await import("../../packages/repositories/preact-repair-history-v3.ts");
    const ready = freshPreactReadiness();
    requireRelease(ready.available, ready.reason);
    verifyReleaseFreeze(freezeSha);
    validateReleaseAdmission(admission, await releaseFacts());
    const at = new Date().toISOString();
    output("STARTED.json", { ...decision, freezeSha256: freezeSha, dispatchPlanSha256: argument,
      controllerPid: process.pid, at, inference: "none yet", execution: "Qualification envelope consumed before live production engine start; never retry" });
    const { runFreshPreact } = await import("../../packages/repositories/preact-repair-v4.ts");
    const result = await runFreshPreact({ id: admission.id, entrypoint: "cli" });
    output("runtime-result.json", result);
    console.log(JSON.stringify({ status: result.status, id: result.id, requests: result.requests,
      operations: result.operations, verified: result.verified, executionUncertain: result.executionUncertain,
      estimatedInferenceUsd: result.estimatedInferenceUsd, provenance: result.provenance }));
  }
} catch (error) {
  let message = error instanceof Error ? error.message : "Release qualification stopped";
  const { assertNativeNoSecrets } = await import("../../packages/repositories/preact-pack-v1.ts");
  try { assertNativeNoSecrets(message); } catch { message = "Release qualification stopped; private evidence requires review"; }
  if (!existsSync(RELEASE_ROOT + "/controller-failure.json")) output("controller-failure.json", {
    status: "STOPPED", message, at: new Date().toISOString(),
    slotConsumed: existsSync(RELEASE_ROOT + "/STARTED.json"), inference: "See append-only engine records; never assume zero after dispatch",
    execution: "Reviewed controller stopped; no automatic retry, recovery or lease removal" });
  console.error(message); process.exitCode = 1;
}
