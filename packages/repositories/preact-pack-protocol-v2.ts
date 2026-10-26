import { readFileSync } from "node:fs";
import { shaNative } from "../evaluation/preact-native-v5.ts";
import { auditNativeReview } from "./native-review-protocol-v2.ts";
export const PACK_V2_FREEZE = "e97f9adf986fb5007dcee085d91e5075c1da56289da480692ab58a7bdd8f3788";
export const packV2Assets = [
  "packages/repositories/preact-pack-protocol-v2.ts",
  "packages/repositories/preact-pack-v2.ts",
  "packages/repositories/preact-replay-v2.ts",
  "packages/execution/preact-replay-v2.ts",
  "apps/repositories/preact-product-v2.ts",
  "apps/api/preact-product-v2.ts",
  "apps/api/native-server-v4.ts",
  "apps/web/src/SelectedPreactPack.tsx",
  "apps/web/selected-pack.html",
  "apps/web/src/FreshPreactV3.tsx",
  "apps/web/native-repair-v3.html",
  "vite.native-v4.config.ts",
  "tests/preact-pack-v2.test.ts",
  "tests/preact-pack-api-v2.test.ts",
  "scripts/preact-pack-browser-v2.mjs",
  "evaluation/PREACT_SELECTED_PACK_V2.md",
  "evaluation/preact-selected-f6ede26e.json",
  "evaluation/preact-user-success-f6ede26e.json",
];
export const packV2Settings = {
  format: "repolab-preact-selected-pack-protocol/v2",
  originRunId: "f6ede26e-b21d-4160-9d24-5893bb8245c2",
  selectedSourceHash:
    "30b97465193b9706a1ed4046bdbcc54b686a9d686a03848f2533515597d3b4e5",
  parentRepairFreeze:
    "9d2adf0281bbea3763940b5f3d75e75fd2094fb92a479f369296adc495bd24c3",
  qualificationReplays: 2,
  maxOperationsPerReplay: 14,
  inferenceCalls: 0,
  independentInputsExported: 0,
};
export function packV2Bytes(path: string) {
  const b = readFileSync(path);
  return path === packV2Assets[0]
    ? Buffer.from(b.toString().replace(PACK_V2_FREEZE, "__PACK_V2_FREEZE__"))
    : b;
}
export function auditNativePackV2(reader = packV2Bytes) {
  auditNativeReview();
  const p = JSON.parse(
      readFileSync("evaluation/preact-selected-pack-v2.json", "utf8"),
    ),
    { digest, assets, ...settings } = p;
  if (
    digest !== PACK_V2_FREEZE ||
    JSON.stringify(settings) !== JSON.stringify(packV2Settings) ||
    shaNative(JSON.stringify({ ...settings, assets })) !== digest ||
    assets.length !== packV2Assets.length ||
    assets.some(
      (a: any, i: number) =>
        a.path !== packV2Assets[i] || a.sha256 !== shaNative(reader(a.path)),
    )
  )
    throw Error("Selected native pack v2 freeze changed");
  return p;
}
