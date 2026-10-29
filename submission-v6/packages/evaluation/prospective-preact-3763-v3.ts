import { existsSync, readFileSync } from "node:fs";
import { isDeepStrictEqual } from "node:util";
import type { DiagnosticOriginalNativeProfile } from "../execution/profiled-native-v2.ts";
import { auditSandboxTransportQualification } from "./sandbox-transport-v1.ts";
import {
  auditFocus as auditV2, auditPreviousAttempt as auditV1History,
  focusAssets as assetsV2, focusRequest, focusHash, parseFocusReceipt,
  FOCUS_IMAGE, FOCUS_TASK, FOCUS_COMMIT, FOCUS_FREEZE as freezeV2,
  focusSlots, focusSaved, focusUploads,
} from "./prospective-preact-3763-v2.ts";
export { verifyFocusSource, focusHash, parseFocusReceipt, focusSuite, focusCommands } from "./prospective-preact-3763-v2.ts";
export { FOCUS_IMAGE, FOCUS_TASK, FOCUS_COMMIT, focusSlots, focusSaved, focusUploads, focusRequest };

export const FOCUS_FREEZE: string = "cd96116fce0a9a6ee3071e7627b72a96028f00d5e06ee70e431d00ea096726bf";
export const TRANSPORT_FREEZE = "34d1982a844531ca98401d542676ddb3ab554b33ecfb1b3d0030f157bd47869f";
const rejected = ".repolab/prospective-preact-3763-v2/run/";
const reconciliation = ".repolab/prospective-preact-3763-provider-rejection-v1/";
const reconciliationFreeze = "1279a395ac0e8ef9c5269030947cec26f00a630ce2522690576aaf930a78c188";
const requestId = "3d2b1aef285ea125a4cf1067223323a2";
const rawHash = "dd321b7cf204c6c8e9957a9d5807707a7517764d587ef558fa446e153cbe1142";
export const focusAssets = [...new Set([
  "packages/evaluation/prospective-preact-3763-v3.ts",
  "apps/evaluator/prospective-preact-3763-v3.ts",
  "tests/prospective-preact-3763-v3.test.ts",
  "evaluation/PROSPECTIVE_PREACT_3763_V3.md",
  "evaluation/prospective-preact-3763-v2.json",
  ...assetsV2,
  "evaluation/sandbox-transport-v1.json",
  "packages/evaluation/sandbox-transport-v1.ts",
  "packages/execution/profiled-native-v2.ts",
  "packages/execution/sandbox-transport-v1.ts",
  rejected + "lint.json", rejected + "binding.json",
  ...["freeze.json", "source-message.json", "rejection-evidence.json", "reviewed-inputs.json",
    "apply-plan.json", "application-review.json", "filesystem-controls.json", "decision.json", "completion.json",
    "archived-guards/active-execution.json", "archived-guards/repository-lease.lock", "archived-guards/global-lease.lock",
  ].map(p => reconciliation + p),
])];
export function focusBytes(path: string) {
  const bytes = readFileSync(path);
  return path === focusAssets[0] ? Buffer.from(bytes.toString().replace(FOCUS_FREEZE, "__FOCUS_FREEZE__")) : bytes;
}

/** One provider-attested rejection only. Generic HTTP failures remain unknown. */
export function auditRejectedAttempt(reader = focusBytes) {
  const read = (path: string) => JSON.parse(reader(path).toString());
  const raw = read(rejected + "lint.json"), binding = read(rejected + "binding.json");
  const evidence = read(reconciliation + "rejection-evidence.json");
  const decision = read(reconciliation + "decision.json"), completion = read(reconciliation + "completion.json");
  const { rawSha256: archivedRawHash, ...owner } = read(reconciliation + "archived-guards/active-execution.json");
  if (archivedRawHash !== rawHash || focusHash(reader(rejected + "lint.json")) !== rawHash || raw.state !== "UNKNOWN" || raw.id || raw.latest ||
      raw.receiptValidated === true || raw.slot !== "lint" || raw.inference !== "none" ||
      raw.execution !== "nebius-sandbox; reviewed original" ||
      !isDeepStrictEqual(raw.request, focusRequest("lint", FOCUS_IMAGE)) || !isDeepStrictEqual(owner, raw.owner) ||
      owner.requestSha256 !== focusHash(JSON.stringify(raw.request))) throw Error("Retained rejected request changed");
  if (evidence.decision !== "PROVIDER_CONFIRMED_REJECTED_NO_OPERATION" ||
      evidence.authority.kind !== "provider_support_access_log_attestation" || evidence.authority.ticket !== "CLOUDSUPPORT-1237160" ||
      evidence.authority.messageId !== "1a15aefb732e5efc" ||
      evidence.authority.sourceSha256 !== focusHash(reader(reconciliation + "source-message.json")) ||
      evidence.event.requestId !== requestId || evidence.event.httpStatus !== 500 ||
      evidence.event.method !== "POST" || evidence.event.path !== "/sandboxes/v1/instances" ||
      evidence.event.operationCreated !== false || evidence.event.instanceWorkStarted !== false ||
      evidence.event.lintCommandRan !== false || evidence.event.operationId !== null ||
      evidence.correlation.localRequestSha256 !== owner.requestSha256 ||
      evidence.qualification.priorWorkflowResumable !== false || evidence.qualification.originalQualified !== false ||
      evidence.limitations.noGeneral500RejectionRule !== true) throw Error("Exact provider rejection attestation required");
  if (focusHash(reader(reconciliation + "freeze.json")) !== reconciliationFreeze ||
      decision.state !== "PROVIDER_REJECTED_NO_OPERATION" || decision.verified !== false ||
      decision.providerRequestId !== requestId || decision.operationId !== null || decision.rawSha256 !== rawHash ||
      decision.freezeSha256 !== reconciliationFreeze || decision.planSha256 !== focusHash(reader(reconciliation + "apply-plan.json")) ||
      decision.executionAdmission !== false || decision.newExecutionFreezeRequired !== true ||
      completion.status !== "RECONCILED_PROVIDER_REJECTED_UNQUALIFIED" || completion.operationCreated !== false ||
      completion.receiptAcceptanceResolved !== true || completion.unknownSubmissionCount !== 0 ||
      completion.archivedOwnedGuards !== 3 || completion.originalQualified !== false || completion.oldWorkflowResumable !== false ||
      completion.freezeSha256 !== reconciliationFreeze || completion.planSha256 !== decision.planSha256 ||
      completion.providerRequestId !== requestId || completion.executionAdmission !== false ||
      completion.originalRawState !== "UNKNOWN" || completion.billingConfirmed !== false || completion.chargeUsd !== null)
    throw Error("Completed rejection reconciliation required");
  if (binding.execution !== raw.execution || !Array.isArray(binding.leases) || binding.leases.length !== 2 ||
      binding.leases.some((l: any, i: number) => l.path !== [".repolab/clsx-repair.lock", ".repolab/repositories/clsx-repair.lock"][i] ||
        JSON.parse(l.bytes).runId !== binding.id || reader(reconciliation + "archived-guards/" + ["global-lease.lock", "repository-lease.lock"][i]).toString() !== l.bytes))
    throw Error("Archived rejected workflow ownership changed");
  if (existsSync(rejected + "active-execution.json") || focusSlots.slice(1).some(s => existsSync(rejected + s + ".json")))
    throw Error("Consumed V2 workflow must remain closed");
  return { freeze: freezeV2, submission: "PROVIDER_CONFIRMED_REJECTED", providerRequestId: requestId,
    operations: 0, rejectedPosts: 1, unknownSubmissions: 0, rawState: "UNKNOWN", resumable: false, billingConfirmed: false };
}
export function auditPreviousAttempt() {
  auditV2();
  return { ...auditV1History(), rejectedAttempt: auditRejectedAttempt() };
}
export function auditFocus(reader = focusBytes) {
  const p = JSON.parse(readFileSync("evaluation/prospective-preact-3763-v3.json", "utf8")), { digest, ...payload } = p;
  if (FOCUS_FREEZE === "__UNFROZEN__" || digest !== FOCUS_FREEZE || focusHash(JSON.stringify(payload)) !== digest ||
      p.taskId !== FOCUS_TASK || p.commit !== FOCUS_COMMIT || p.image !== FOCUS_IMAGE || p.previousFreeze !== freezeV2 ||
      p.transportFreeze !== TRANSPORT_FREEZE || p.transportClient !== "profiled-native-v2" || p.executionAdmission !== true ||
      p.inferenceCalls !== 0 || p.modelAdmission !== false || p.candidateAdmission !== false ||
      p.maxOperations !== 7 || p.priorOperations !== 5 || p.priorRejectedPosts !== 1 || p.taskOriginalCeiling !== 12 ||
      !isDeepStrictEqual(p.slots, focusSlots) || p.assets.length !== focusAssets.length ||
      p.assets.some((a: any, i: number) => a.path !== focusAssets[i] || a.sha256 !== focusHash(reader(a.path))))
    throw Error("V3 exact original diagnostic execution freeze changed");
  if (auditSandboxTransportQualification().digest !== TRANSPORT_FREEZE) throw Error("Frozen diagnostic transport required");
  auditPreviousAttempt();
  return p;
}
export const focusProfile: DiagnosticOriginalNativeProfile = {
  id: "prospective-preact-3763-v3", image: FOCUS_IMAGE, inputDirectory: "/opt/repolab/prospective-native",
  slots: focusSlots, savedSlots: focusSaved, uploads: focusUploads, audit: auditFocus, request: focusRequest, parse: parseFocusReceipt,
  transportFreeze: TRANSPORT_FREEZE, executionFreeze: FOCUS_FREEZE,
};
