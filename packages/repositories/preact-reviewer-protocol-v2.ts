import { readFileSync } from "node:fs";
import { shaNative } from "../evaluation/preact-native-v5.ts";
import { auditNativePackV3 } from "./preact-pack-protocol-v3.ts";

export const REVIEWER_V2_FREEZE = "bb4d209f0de115bda1c721f0aee9864464df3c19c756d1267456ced96f3b9efa";
export const reviewerV2Assets = [
  "packages/repositories/preact-reviewer-protocol-v2.ts",
  "scripts/native-reviewer-bootstrap-v2.mjs",
  "scripts/native-reviewer-bootstrap-v2.d.mts",
  "tests/native-reviewer-bootstrap-v2.test.ts",
  "docs/NATIVE_REVIEWER_SETUP_V2.md",
  "evaluation/PREACT_REVIEWER_V2.md",
];
export const reviewerV2Settings = {
  format: "repolab-native-reviewer-qualification/v2",
  parentPackFreeze:
    "e57f7d519c90c86747d826c5926c52be9b7850a35e043ed6e77a88d867fa7422",
  originRunId: "f8bfb85d-6766-4a9e-a762-e362d011559c",
  sourceHash:
    "68c9000eec6e0ed71f140c8af231309064d1e7447414f00136cbb91b4e3eb0d3",
  packDigest:
    "986ae095cd7224c608b19cfd8d4e00a33dcc779a858fc79faf6a6c5468a5b841",
  installs: 2,
  isolationOperationsPerInstall: 5,
  fixtureSmokeOperationsPerInstall: 2,
  replayOperationsPerInstall: 14,
  totalPlannedOperations: 42,
  inferenceCalls: 0,
  qualificationRetry: false,
  focusedTestFiles: [
    "tests/native-reviewer-bootstrap-v2.test.ts",
    "tests/preact-pack-v3.test.ts",
    "tests/preact-replay-v3.test.ts",
  ],
  scope:
    "two clean controller/dependency/state directories on one machine; same Sandbox project and cached native image; CLI delivery",
};
export function reviewerV2Bytes(path: string) {
  const b = readFileSync(path);
  return path === reviewerV2Assets[0]
    ? Buffer.from(
        b.toString().replace(REVIEWER_V2_FREEZE, "__REVIEWER_V2_FREEZE__"),
      )
    : b;
}
export function auditNativeReviewerV2(reader = reviewerV2Bytes) {
  auditNativePackV3();
  const p = JSON.parse(
      readFileSync("evaluation/preact-reviewer-v2.json", "utf8"),
    ),
    { digest, assets, ...settings } = p;
  if (
    digest !== REVIEWER_V2_FREEZE ||
    JSON.stringify(settings) !== JSON.stringify(reviewerV2Settings) ||
    shaNative(JSON.stringify({ ...settings, assets })) !== digest ||
    assets.length !== reviewerV2Assets.length ||
    assets.some(
      (a: any, i: number) =>
        a.path !== reviewerV2Assets[i] ||
        a.sha256 !== shaNative(reader(a.path)),
    )
  )
    throw Error("Native reviewer v2 freeze changed");
  return p;
}
