import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { auditSandboxTransportQualification, TRANSPORT_FREEZE } from "./sandbox-transport-v1.ts";

export const STATUS_RETRY_FREEZE: string = "b2a0138834bc885434017b195f19cbb87e1cc9c1c5a9697dcb1f885e23be1b6d";
export const statusRetryAssets = [
  "packages/evaluation/sandbox-status-retry-v1.ts",
  "packages/execution/sandbox-status-retry-v1.ts",
  "packages/execution/profiled-native-v3.ts",
  "apps/evaluator/sandbox-status-retry-v1.ts",
  "tests/sandbox-status-retry-v1.test.ts",
  "evaluation/SANDBOX_STATUS_RETRY_V1.md",
  "evaluation/sandbox-transport-v1.json",
  "packages/execution/profiled-native-v2.ts",
  "packages/execution/sandbox-transport-v1.ts",
  "packages/evaluation/sandbox-transport-v1.ts",
  ".repolab/sandbox-status-retry-v1-qualification/historical-code.json",
  ".repolab/sandbox-status-retry-v1-qualification/execution-state.json",
];
export const statusRetryHash = (bytes: string | Uint8Array) => createHash("sha256").update(bytes).digest("hex");
export function statusRetryBytes(path: string) {
  const bytes = readFileSync(path);
  return path === statusRetryAssets[0] ? Buffer.from(bytes.toString().replace(STATUS_RETRY_FREEZE, "__STATUS_RETRY_FREEZE__")) : bytes;
}
export function auditSandboxStatusRetryQualification(reader = statusRetryBytes) {
  const p = JSON.parse(reader("evaluation/sandbox-status-retry-v1.json").toString()), { digest, ...payload } = p;
  if (STATUS_RETRY_FREEZE === "__UNFROZEN__" || digest !== STATUS_RETRY_FREEZE || statusRetryHash(JSON.stringify(payload)) !== digest ||
      p.status !== "OFFLINE_PROTOCOL_FROZEN" || p.executionAdmission !== false || p.transportFreeze !== TRANSPORT_FREEZE ||
      p.transportClient !== "profiled-native-v3" || p.maxModelCalls !== 0 || p.maxSandboxOperations !== 0 ||
      JSON.stringify(p.retryPolicy) !== JSON.stringify({ method: "GET", resource: "exact-operation-uuid", maxExtraReadsPerOperation: 2,
        maxAttemptsPerRead: 3, retryDelaysMs: [1000, 2000], httpStatuses: [500, 502, 503, 504] }) ||
      p.assets.length !== statusRetryAssets.length ||
      p.assets.some((a: any, i: number) => a.path !== statusRetryAssets[i] || a.sha256 !== statusRetryHash(reader(a.path))))
    throw Error("Frozen offline status retry qualification required");
  auditSandboxTransportQualification();
  return p;
}
