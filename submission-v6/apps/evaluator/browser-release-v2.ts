import { existsSync } from "node:fs";
import { createQualifiedServer } from "../api/qualified-server-v2.ts";
import { Store } from "../../packages/storage/store.ts";
import { FreshPreactHistory } from "../../packages/repositories/preact-repair-history-v4.ts";
import { freshPreactReadiness } from "../../packages/repositories/preact-repair-history-v3.ts";
import { runFreshPreact } from "../../packages/repositories/preact-repair-v4.ts";
import { assertNativeNoSecrets } from "../../packages/repositories/preact-pack-v1.ts";
import { RELEASE_ROOT as ROOT, readBrowserRecord as read, regularBytes, digest, requireRelease as need,
  verifyBrowserFreeze, browserFacts, validateBrowserAdmission, validateOwnedBrowserClaim,
  claimBrowserSlot, queuedBrowserRecord, withQueuedBrowserRecord } from "../../packages/evaluation/browser-release-v2.ts";
const [mode, freezeSha, argument] = process.argv.slice(2);
const output = (name: string, value: unknown) => claimBrowserSlot(ROOT + "/" + name, value);
const sanitize = (error: unknown) => {
  let message = error instanceof Error ? error.message.slice(0, 1800) : "Browser qualification stopped";
  try { assertNativeNoSecrets(message); } catch { message = "Browser qualification stopped; private evidence requires review"; }
  return message;
};
function reviewedPlan() {
  const bytes = regularBytes(ROOT + "/dispatch-plan.json"), plan = JSON.parse(bytes.toString()), a = read("admission.json");
  need(digest(bytes) === argument && plan.freezeSha256 === freezeSha && plan.id === a.id && plan.workflowSlots === 1 && plan.entrypoint === "api" && plan.driver === "browser", "Exact reviewed browser dispatch plan required");
  need(regularBytes(ROOT + "/audit-1.json").equals(regularBytes(ROOT + "/audit-2.json")), "Keyless browser plans differ");
  for (const name of ["audit-1.json", "audit-2.json", "controls-audit.json"]) {
    const b = regularBytes(ROOT + "/" + name), record = JSON.parse(b.toString());
    need(digest(b) === plan.qualificationHashes[name] && record.status.startsWith("PASS"), "Browser qualification record changed");
  }
  need(read("controls-audit.json").passedTests >= 40 && read("controls-audit.json").failedTests === 0, "Complete browser controller controls required");
  return plan;
}
try {
  need(mode === "audit" || mode === "serve", "Explicit audit/serve required");
  const pinned = verifyBrowserFreeze(freezeSha), a = read("admission.json");
  if (mode === "audit") globalThis.fetch = async () => { throw Error("Provider fetch forbidden in keyless browser audit"); };
  const facts = await browserFacts(), decision = validateBrowserAdmission(a, facts);
  if (mode === "audit") {
    need(argument === "audit-1.json" || argument === "audit-2.json", "Closed keyless audit destination required");
    output(argument, { status: "PASS_KEYLESS_BROWSER_PLAN", freezeSha256: freezeSha, decision, facts,
      priorPrivateJsonFilesMatched: pinned.priorCount, inference: "none", execution: "Network-blocked empty-environment source/evidence/ledger audit only" });
    console.log(JSON.stringify({ status: "PASS_KEYLESS_BROWSER_PLAN", priorFiles: pinned.priorCount }));
  } else {
    reviewedPlan();
    const configured = freshPreactReadiness(); need(configured.available, configured.reason);
    let engineInvoked = false;
    const stopRecord = (error: unknown) => {
      if (!existsSync(ROOT + "/execution-stopped.json")) output("execution-stopped.json", {
        status: "STOPPED", message: sanitize(error), at: new Date().toISOString(), id: a.id,
        envelopeConsumed: existsSync(ROOT + "/STARTED.json"), engineInvoked,
        inference: "See raw engine journal and usage; zero only if engine never invoked",
        execution: "No automatic retry or recovery; existing raw evidence and guards retained" });
    };
    const admission = { id: a.id,
      readiness: () => ({ available: !existsSync(ROOT + "/STARTED.json"), reason: existsSync(ROOT + "/STARTED.json") ? "This admitted browser workflow is consumed." : "One reviewed browser repair is ready. Up to three model calls and 34 isolated operations." }),
      consume: async () => {
        const owner = { ...decision, freezeSha256: freezeSha, dispatchPlanSha256: argument, id: a.id,
          at: new Date().toISOString(), controllerPid: process.pid, inference: "none yet", execution: "Durable browser envelope claimed before final preflight or provider work" };
        claimBrowserSlot(ROOT + "/STARTED.json", owner);
        try {
          verifyBrowserFreeze(freezeSha); reviewedPlan();
          validateOwnedBrowserClaim(a, await browserFacts(), JSON.parse(regularBytes(ROOT + "/STARTED.json").toString()), owner);
        } catch (error) { stopRecord(error); throw error; }
        const ready = freshPreactReadiness();
        if (!ready.available) { const error = Error(ready.reason); stopRecord(error); throw error; }
        setImmediate(() => { if (!engineInvoked) stopRecord(Error("Admission completed without engine invocation; no provider work dispatched")); });
      },
    };
    // STARTED is uppercase by design; its reader is closed separately from ordinary record names.
    const history = withQueuedBrowserRecord(new FreshPreactHistory(), () => {
      if (!existsSync(ROOT + "/STARTED.json") || existsSync(".repolab/native-preact-repairs-v4/repair-" + a.id + "/journal.json")) return null;
      const claim = JSON.parse(regularBytes(ROOT + "/STARTED.json").toString());
      need(claim.id === a.id, "Queued browser identity changed");
      const error = existsSync(ROOT + "/execution-stopped.json") ? "Admission stopped before guest execution; no automatic retry." : null;
      return queuedBrowserRecord(a.id, claim.at, error);
    });
    const store = new Store(".repolab/state.sqlite");
    const service = createQualifiedServer(store, "dist/qualified-v5", 0, { admission, history,
      execute: async (options = {}) => {
        engineInvoked = true;
        try {
          need(options.id === a.id && options.entrypoint === "api" && !options.simulation && !options.root, "Closed production API engine options required");
          const result = await runFreshPreact(options);
          output("runtime-result.json", result);
          return result;
        } catch (error) { stopRecord(error); throw error; }
      },
    });
    const port = await service.start();
    output("server-ready.json", { status: "READY_ONE_BROWSER_WORKFLOW", id: a.id, origin: `http://127.0.0.1:${port}`, freezeSha256: freezeSha,
      controllerPid: process.pid, inference: "none yet", execution: "Exact qualified V4 frontend and API on temporary loopback server; one durable admission only" });
    console.log(JSON.stringify({ status: "READY_ONE_BROWSER_WORKFLOW", port, id: a.id }));
    let closing = false;
    const stop = () => { if (closing) return; closing = true; void service.close().finally(() => {
      store.close(); output("server-stopped.json", { status: "CLOSED", at: new Date().toISOString(), inference: "No new inference during shutdown", execution: "Local server closed; consumed envelope unchanged" }); process.exit(0);
    }); };
    process.once("SIGINT", stop); process.once("SIGTERM", stop);
  }
} catch (error) {
  const message = sanitize(error);
  if (!existsSync(ROOT + "/controller-failure.json")) output("controller-failure.json", { status: "STOPPED", message, at: new Date().toISOString(),
    envelopeConsumed: existsSync(ROOT + "/STARTED.json"), inference: "No inference assumed; inspect raw records if consumed", execution: "Browser controller stopped; no retry or automatic recovery" });
  console.error(message); process.exitCode = 1;
}
