import { readFileSync } from "node:fs";
import { shaNative } from "../evaluation/preact-native-v5.ts";
import {
  auditTrialFreeze,
  trialAssets,
} from "../evaluation/preact-trial-v10.ts";
import { auditPortableProtocol } from "./portable-protocol.ts";
export const PRODUCT_FREEZE = "67f936c274f3716f82f924c8fd1d4663b095b04d6d9853c0fa361cba0740e473";
export const productAssets = [
  "packages/repositories/preact-product-protocol-v1.ts",
  "packages/repositories/preact-pack-v1.ts",
  "packages/repositories/preact-replay-v1.ts",
  "packages/execution/preact-replay-v1.ts",
  "apps/api/preact-product-v1.ts",
  "apps/api/native-server-v1.ts",
  "apps/repositories/preact-product-v1.ts",
  "apps/web/native.html",
  "apps/web/src/NativePreact.tsx",
  "apps/web/src/native-preact.css",
  "vite.config.ts",
  "tests/preact-product-v1.test.ts",
  "tests/preact-product-api-v1.test.ts",
  "scripts/preact-product-browser-v1.mjs",
  "evaluation/PREACT_PRODUCT_V1.md",
  "evaluation/preact-trial-v10.json",
  "evaluation/preact-trial-v10-results-summary.json",
  "evaluation/preact-trial-v10-selected.patch",
  "evaluation/preact-trial-v10-selected-patch.json",
  "evaluation/preact-trial-v1-results-summary.json",
  "evaluation/preact-trial-v2-results-summary.json",
  "evaluation/preact-trial-v3-results-summary.json",
  "evaluation/preact-trial-v4-results-summary.json",
  "evaluation/preact-trial-v5-results-summary.json",
  "evaluation/preact-trial-v6-results-summary.json",
  "evaluation/preact-trial-v7-results-summary.json",
  "evaluation/preact-trial-v9-results-summary.json",
  ...trialAssets,
];
export function productBytes(path: string) {
  const b = readFileSync(path);
  return path === productAssets[0]
    ? Buffer.from(b.toString().replace(PRODUCT_FREEZE, "__PRODUCT_FREEZE__"))
    : b;
}
export function auditPreactProduct(reader = productBytes) {
  auditTrialFreeze();
  auditPortableProtocol();
  const p = JSON.parse(
      readFileSync("evaluation/preact-product-v1.json", "utf8"),
    ),
    { digest, ...payload } = p;
  if (
    digest !== PRODUCT_FREEZE ||
    shaNative(JSON.stringify(payload)) !== digest ||
    p.format !== "repolab-preact-product/v1" ||
    p.inferenceCalls !== 0 ||
    p.maxOperations !== 14 ||
    p.assets.length !== productAssets.length ||
    p.assets.some(
      (a: { path: string; sha256: string }, i: number) =>
        a.path !== productAssets[i] || a.sha256 !== shaNative(reader(a.path)),
    )
  )
    throw Error("Native product freeze changed");
  return p;
}
