import { readFileSync } from "node:fs";
import { shaNative } from "../evaluation/preact-native-v5.ts";
import { auditFreshPreact } from "./preact-repair-protocol-v2.ts";
import { auditNativeReplayV3 } from "./preact-replay-protocol-v3.ts";

export const PACK_V3_FREEZE = "e57f7d519c90c86747d826c5926c52be9b7850a35e043ed6e77a88d867fa7422";
export const packV3Assets = [
  "packages/repositories/preact-pack-protocol-v3.ts",
  "packages/repositories/preact-pack-v3.ts",
  "packages/repositories/preact-replay-v4.ts",
  "packages/execution/preact-replay-v3.ts",
  "apps/repositories/preact-product-v4.ts",
  "tests/preact-pack-v3.test.ts",
  "tests/preact-repair-fixture-v1.ts",
  "evaluation/PREACT_SELECTED_PACK_V3.md",
  "evaluation/archive/preact-selected-pack-v3-preparation/manifest.json",
  "evaluation/preact-selected-f8bfb85d.json",
  "evaluation/preact-reliability-v2-results-summary.json",
];
export const packV3Settings = {
  format: "repolab-preact-selected-pack-protocol/v3",
  originRunId: "f8bfb85d-6766-4a9e-a762-e362d011559c",
  selectedSourceHash:
    "68c9000eec6e0ed71f140c8af231309064d1e7447414f00136cbb91b4e3eb0d3",
  parentRepairFreeze:
    "822e3305ca5379405834096ca7807a849f567bdd9f2aea5e382ad25d285ae402",
  transportFreeze:
    "8bd58da6db6ee6f128d523de7f60d143ce8da8f8e7c9a7b13b7caa213e328aef",
  previousUnrunPreparationFreeze:
    "475f3e978e23b01fc8c05a4bbf753fab0be2cfda6a52ff083da6a73ada5e686a",
  qualificationReplays: 2,
  qualificationRetry: false,
  maxOperationsPerReplay: 14,
  inferenceCalls: 0,
  independentInputsExported: 0,
};
export function packV3Bytes(path: string) {
  const b = readFileSync(path);
  return path === packV3Assets[0]
    ? Buffer.from(b.toString().replace(PACK_V3_FREEZE, "__PACK_V3_FREEZE__"))
    : b;
}
export function auditNativePackV3(reader = packV3Bytes) {
  auditFreshPreact();
  auditNativeReplayV3();
  const p = JSON.parse(
      readFileSync("evaluation/preact-selected-pack-v3.json", "utf8"),
    ),
    { digest, assets, ...settings } = p;
  if (
    digest !== PACK_V3_FREEZE ||
    JSON.stringify(settings) !== JSON.stringify(packV3Settings) ||
    shaNative(JSON.stringify({ ...settings, assets })) !== digest ||
    assets.length !== packV3Assets.length ||
    assets.some(
      (a: any, i: number) =>
        a.path !== packV3Assets[i] || a.sha256 !== shaNative(reader(a.path)),
    )
  )
    throw Error("Selected native pack v3 freeze changed");
  return p;
}
