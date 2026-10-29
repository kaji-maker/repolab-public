import { readFileSync } from "node:fs";
import { shaNative } from "../evaluation/preact-native-v5.ts";
import {
  trialContext,
  trialSystem,
  trialSettings,
} from "../evaluation/preact-reliability-v2.ts";
import { auditFreshPreact as auditParent } from "./preact-repair-protocol-v2.ts";
export const REPAIR_FREEZE =
  "e50e387594890fcbcff387c1e1e95d90ea857b320105c8c765ecbd226a384449";
export const freshAssets = [
  "packages/repositories/preact-repair-protocol-v3.ts",
  "packages/execution/guarded-preact-sandbox-v1.ts",
  "packages/execution/preact-repair-v3.ts",
  "packages/execution/recovery-lease-v1.ts",
  "packages/repositories/preact-repair-v3.ts",
  "packages/repositories/preact-repair-history-v3.ts",
  "packages/repositories/preact-repair-recovery-v1.ts",
  "apps/api/preact-repair-v3.ts",
  "apps/api/native-server-v8.ts",
  "apps/web/src/FreshPreactV7.tsx",
  "apps/web/native-repair-v7.html",
  "vite.native-v8.config.ts",
  "tests/preact-repair-v3.test.ts",
  "tests/preact-repair-guard-v1.test.ts",
  "tests/preact-repair-api-v3.test.ts",
  "scripts/preact-guard-browser-v1.mjs",
  "evaluation/PREACT_PRODUCT_REPAIR_V3.md",
];
export const freshSettings = {
  format: "repolab-native-preact-repair-protocol/v3",
  taskId: trialSettings.taskId,
  profileFreeze:
    "2bfd0055be82c8f4a1dd77f232d08f0c5fb227d72c41b972f5903fdec6a18384",
  productFreeze:
    "e08a4ca2dbbc6f8b6452c0e832c46e5ccbab2945a5295149d1e73954698fcc70",
  maxCandidates: 3,
  maxCalls: 3,
  maxOperations: 34,
  monetaryCap: null,
  parentRepairFreeze:
    "822e3305ca5379405834096ca7807a849f567bdd9f2aea5e382ad25d285ae402",
  recognizedTerminal: ["SUCCESS", "FAILED", "CANCELLED"],
  recovery: "GET only; no verification or workflow resume",
  newLiveQualificationSlots: 0,
  independentFeedback: false,
};
export function freshBytes(path: string) {
  const bytes = readFileSync(path);
  return path === freshAssets[0]
    ? Buffer.from(bytes.toString().replace(REPAIR_FREEZE, "__REPAIR_FREEZE__"))
    : bytes;
}
export function auditFreshPreact(reader = freshBytes) {
  auditParent();
  if (String(REPAIR_FREEZE) === "__UNFROZEN__")
    throw Error("Guarded product protocol is not frozen");
  const p = JSON.parse(
    readFileSync("evaluation/preact-product-repair-v3.json", "utf8"),
  );
  const { digest, assets, contextHash, systemHash, ...settings } = p;
  if (
    digest !== REPAIR_FREEZE ||
    JSON.stringify(settings) !== JSON.stringify(freshSettings) ||
    contextHash !== shaNative(JSON.stringify(trialContext(1))) ||
    systemHash !== shaNative(trialSystem) ||
    shaNative(
      JSON.stringify({ ...settings, contextHash, systemHash, assets }),
    ) !== digest ||
    assets.length !== freshAssets.length ||
    assets.some(
      (a: any, i: number) =>
        a.path !== freshAssets[i] || a.sha256 !== shaNative(reader(a.path)),
    )
  )
    throw Error("Fresh native repair protocol changed");
  return p;
}
