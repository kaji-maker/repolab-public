import { readFileSync } from "node:fs";
import { shaNative } from "../evaluation/preact-native-v5.ts";
import {
  trialContext,
  trialSystem,
  trialSettings,
} from "../evaluation/preact-trial-v10.ts";
import { auditPreactProduct } from "./preact-product-protocol-v1.ts";
export const REPAIR_FREEZE = "9d2adf0281bbea3763940b5f3d75e75fd2094fb92a479f369296adc495bd24c3";
export const freshAssets = [
  "packages/repositories/preact-repair-protocol-v1.ts",
  "packages/repositories/preact-repair-v1.ts",
  "packages/repositories/preact-repair-history-v1.ts",
  "packages/execution/preact-repair-v1.ts",
  "apps/api/preact-repair-v1.ts",
  "apps/api/native-server-v2.ts",
  "apps/web/native-repair.html",
  "apps/web/src/FreshPreact.tsx",
  "apps/web/src/fresh-preact.css",
  "vite.native-v2.config.ts",
  "tests/preact-repair-fixture-v1.ts",
  "tests/preact-repair-v1.test.ts",
  "tests/preact-repair-api-v1.test.ts",
  "scripts/preact-repair-browser-v1.mjs",
  "evaluation/PREACT_PRODUCT_REPAIR_V1.md",
  "evaluation/preact-admission-v5-results-summary.json",
  "evaluation/preact-native-v5-results-summary.json",
  "evaluation/preact-trial-v10-results-summary.json",
];
export const freshSettings = {
  format: "repolab-native-preact-repair-protocol/v1",
  taskId: trialSettings.taskId,
  profileFreeze:
    "9a46c592b4538aec6ddf3ea7c9595a7d87ee23b5784a309817acaacf7f9a7bee",
  productFreeze:
    "67f936c274f3716f82f924c8fd1d4663b095b04d6d9853c0fa361cba0740e473",
  maxCandidates: 3,
  maxCalls: 3,
  maxOperations: 34,
  monetaryCap: null,
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
  const p = JSON.parse(
    readFileSync("evaluation/preact-product-repair-v1.json", "utf8"),
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
