import { readFileSync } from "node:fs";
import { shaNative } from "../evaluation/preact-native-v5.ts";
import { auditNativePackV2 } from "./preact-pack-protocol-v2.ts";
export const REPLAY_V3_FREEZE = "8bd58da6db6ee6f128d523de7f60d143ce8da8f8e7c9a7b13b7caa213e328aef";
export const replayV3Assets = [
  "packages/repositories/preact-replay-protocol-v3.ts",
  "packages/execution/preact-replay-v3.ts",
  "packages/repositories/preact-replay-v3.ts",
  "apps/api/preact-product-v3.ts",
  "apps/api/native-server-v5.ts",
  "apps/repositories/preact-product-v3.ts",
  "apps/web/src/SelectedPreactPackV3.tsx",
  "apps/web/selected-pack-v3.html",
  "apps/web/src/FreshPreactV4.tsx",
  "apps/web/native-repair-v4.html",
  "vite.native-v5.config.ts",
  "scripts/preact-pack-browser-v3.mjs",
  "tests/preact-replay-v3.test.ts",
  "evaluation/PREACT_REPLAY_V3.md",
];
export const replayV3Settings = {
  format: "repolab-native-replay-transport/v3",
  parentPackFreeze:
    "e97f9adf986fb5007dcee085d91e5075c1da56289da480692ab58a7bdd8f3788",
  sourceHash:
    "30b97465193b9706a1ed4046bdbcc54b686a9d686a03848f2533515597d3b4e5",
  operationGetTimeoutMs: 60000,
  operationGetAttempts: 3,
  postTimeoutMs: 15000,
  postAttempts: 1,
  cancelTimeoutMs: 60000,
  qualificationReplays: 2,
  maxOperationsPerReplay: 14,
  inferenceCalls: 0,
};
export function replayV3Bytes(path: string) {
  const b = readFileSync(path);
  return path === replayV3Assets[0]
    ? Buffer.from(
        b.toString().replace(REPLAY_V3_FREEZE, "__REPLAY_V3_FREEZE__"),
      )
    : b;
}
export function auditNativeReplayV3(reader = replayV3Bytes) {
  auditNativePackV2();
  const p = JSON.parse(
      readFileSync("evaluation/preact-replay-v3.json", "utf8"),
    ),
    { digest, assets, ...settings } = p;
  if (
    digest !== REPLAY_V3_FREEZE ||
    JSON.stringify(settings) !== JSON.stringify(replayV3Settings) ||
    shaNative(JSON.stringify({ ...settings, assets })) !== digest ||
    assets.length !== replayV3Assets.length ||
    assets.some(
      (a: any, i: number) =>
        a.path !== replayV3Assets[i] || a.sha256 !== shaNative(reader(a.path)),
    )
  )
    throw Error("Native replay transport v3 freeze changed");
  return p;
}
