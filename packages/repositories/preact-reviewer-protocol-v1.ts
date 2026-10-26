import { readFileSync } from "node:fs";
import { shaNative } from "../evaluation/preact-native-v5.ts";
import { auditNativeReplayV3 } from "./preact-replay-protocol-v3.ts";
export const REVIEWER_V1_FREEZE = "e08a4ca2dbbc6f8b6452c0e832c46e5ccbab2945a5295149d1e73954698fcc70";
export const reviewerV1Assets = [
  "packages/repositories/preact-reviewer-protocol-v1.ts",
  "scripts/native-reviewer-bootstrap-v1.mjs",
  "scripts/native-reviewer-bootstrap-v1.d.mts",
  "tests/native-reviewer-bootstrap-v1.test.ts",
  "docs/NATIVE_REVIEWER_SETUP.md",
  "evaluation/PREACT_REVIEWER_V1.md",
];
export const reviewerV1Settings = {
  format: "repolab-native-reviewer-qualification/v1",
  parentReplayFreeze:
    "8bd58da6db6ee6f128d523de7f60d143ce8da8f8e7c9a7b13b7caa213e328aef",
  sourceHash:
    "30b97465193b9706a1ed4046bdbcc54b686a9d686a03848f2533515597d3b4e5",
  packDigest:
    "7b9e9ced1bfaf8b6d8cd056d3e8c848a17b58c47c8b1d991c53e3df0d26d97d4",
  installs: 2,
  isolationOperationsPerInstall: 5,
  fixtureSmokeOperationsPerInstall: 2,
  replayOperationsPerInstall: 14,
  totalPlannedOperations: 42,
  inferenceCalls: 0,
  scope:
    "two fresh directories on one machine; same Sandbox project and cached native image",
};
export function reviewerV1Bytes(path: string) {
  const b = readFileSync(path);
  return path === reviewerV1Assets[0]
    ? Buffer.from(
        b.toString().replace(REVIEWER_V1_FREEZE, "__REVIEWER_V1_FREEZE__"),
      )
    : b;
}
export function auditNativeReviewerV1(reader = reviewerV1Bytes) {
  auditNativeReplayV3();
  const p = JSON.parse(
      readFileSync("evaluation/preact-reviewer-v1.json", "utf8"),
    ),
    { digest, assets, ...settings } = p;
  if (
    digest !== REVIEWER_V1_FREEZE ||
    JSON.stringify(settings) !== JSON.stringify(reviewerV1Settings) ||
    shaNative(JSON.stringify({ ...settings, assets })) !== digest ||
    assets.length !== reviewerV1Assets.length ||
    assets.some(
      (a: any, i: number) =>
        a.path !== reviewerV1Assets[i] ||
        a.sha256 !== shaNative(reader(a.path)),
    )
  )
    throw Error("Native reviewer v1 freeze changed");
  return p;
}
