import { readFileSync } from "node:fs";
import { shaNative } from "../evaluation/preact-native-v5.ts";
import {
  trialContext,
  trialSystem,
  trialSettings,
} from "../evaluation/preact-reliability-v2.ts";
import { auditNativeReviewerV1 as auditPreactProduct } from "./preact-reviewer-protocol-v1.ts";
import { auditProbeFreeze } from "../evaluation/preact-thinking-schema-v2.ts";
export const REPAIR_FREEZE =
  "822e3305ca5379405834096ca7807a849f567bdd9f2aea5e382ad25d285ae402";
export const freshAssets = [
  "packages/repositories/preact-repair-protocol-v2.ts",
  "packages/evaluation/preact-reliability-v2.ts",
  "packages/repositories/preact-generation-v3.ts",
  "tests/preact-generation-v3.test.ts",
  "tests/preact-repair-transport-v2.test.ts",
  "evaluation/preact-thinking-schema-v2.json",
  "evaluation/preact-thinking-schema-v2-results-summary.json",
  "packages/repositories/preact-repair-v2.ts",
  "packages/repositories/preact-repair-history-v2.ts",
  "packages/execution/preact-repair-v2.ts",
  "apps/api/preact-repair-v2.ts",
  "apps/api/native-server-v6.ts",
  "apps/web/native-repair-v5.html",
  "apps/web/src/FreshPreactV5.tsx",
  "apps/web/src/fresh-preact.css",
  "vite.native-v6.config.ts",
  "tests/preact-repair-fixture-v1.ts",
  "tests/preact-repair-v2.test.ts",
  "tests/preact-repair-api-v1.test.ts",
  "scripts/preact-repair-browser-v2.mjs",
  "evaluation/PREACT_PRODUCT_REPAIR_V2.md",
  "evaluation/archive/preact-product-repair-v2-preparation/manifest.json",
  "evaluation/preact-admission-v5-results-summary.json",
  "evaluation/preact-native-v5-results-summary.json",
  "evaluation/preact-trial-v10-results-summary.json",
];
export const freshSettings = {
  format: "repolab-native-preact-repair-protocol/v2",
  taskId: trialSettings.taskId,
  profileFreeze:
    "2bfd0055be82c8f4a1dd77f232d08f0c5fb227d72c41b972f5903fdec6a18384",
  productFreeze:
    "e08a4ca2dbbc6f8b6452c0e832c46e5ccbab2945a5295149d1e73954698fcc70",
  maxCandidates: 3,
  maxCalls: 3,
  maxOperations: 34,
  monetaryCap: null,
  previousUnrunPreparationFreeze:
    "77b51395e8b9a14f86c1405395a04df209bf932723970cc963ea26c8dc8c4306",
  qualificationSlots: 1,
  qualificationRetry: false,
  independentFeedback: false,
};
export function freshBytes(path: string) {
  const bytes = readFileSync(path);
  return path === freshAssets[0]
    ? Buffer.from(bytes.toString().replace(REPAIR_FREEZE, "__REPAIR_FREEZE__"))
    : bytes;
}
export function auditFreshPreact(reader = freshBytes) {
  auditPreactProduct();
  auditProbeFreeze();
  const p = JSON.parse(
    readFileSync("evaluation/preact-product-repair-v2.json", "utf8"),
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
