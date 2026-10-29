import { readFileSync } from "node:fs";
import { shaNative } from "../evaluation/preact-native-v5.ts";
import { auditFreshPreact } from "./preact-repair-protocol-v1.ts";
export const REVIEW_FREEZE = "e6ca02a4b042a17ef7039739bf75c6503b8876f14459429033e8871dd1626af5";
export const reviewAssets = [
  "packages/repositories/native-review-protocol-v2.ts",
  "packages/repositories/native-review-display-v2.ts",
  "apps/web/src/FreshPreactV2.tsx",
  "apps/web/native-repair-v2.html",
  "apps/api/native-server-v3.ts",
  "vite.native-v3.config.ts",
  "tests/native-review-v2.test.ts",
  "scripts/native-review-browser-v2.mjs",
];
export const reviewSettings = {
  format: "repolab-native-review-recovery/v2",
  parentRepairFreeze:
    "9d2adf0281bbea3763940b5f3d75e75fd2094fb92a479f369296adc495bd24c3",
  scope:
    "Read-only recovery qualification of retained abstention; presentation and HTTP keepalive only",
  newInferenceCalls: 0,
  newSandboxOperations: 0,
};
export function reviewBytes(path: string) {
  const b = readFileSync(path);
  return path === reviewAssets[0]
    ? Buffer.from(b.toString().replace(REVIEW_FREEZE, "__REVIEW_FREEZE__"))
    : b;
}
export function auditNativeReview(reader = reviewBytes) {
  auditFreshPreact();
  const p = JSON.parse(
    readFileSync("evaluation/native-review-v2.json", "utf8"),
  );
  const { digest, assets, ...settings } = p;
  if (
    digest !== REVIEW_FREEZE ||
    JSON.stringify(settings) !== JSON.stringify(reviewSettings) ||
    shaNative(JSON.stringify({ ...settings, assets })) !== digest ||
    assets.length !== reviewAssets.length ||
    assets.some(
      (a: any, i: number) =>
        a.path !== reviewAssets[i] || a.sha256 !== shaNative(reader(a.path)),
    )
  )
    throw Error("Native review recovery overlay changed");
  return p;
}
