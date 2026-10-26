import { readFileSync } from "node:fs";
import { shaNative } from "../evaluation/preact-native-v5.ts";
import { auditNativeReviewerV2 } from "./preact-reviewer-protocol-v2.ts";

export const BROWSER_V4_FREEZE = "4d211611dc902224615bf6f03c98e937630969565ee53f593464e86258e7eafc";
export const browserV4Assets = [
  "packages/repositories/preact-browser-protocol-v4.ts",
  "apps/api/preact-product-v4.ts",
  "apps/api/native-server-v7.ts",
  "apps/web/src/SelectedPreactPackV4.tsx",
  "apps/web/src/FreshPreactV6.tsx",
  "apps/web/selected-pack-v4.html",
  "apps/web/native-repair-v6.html",
  "vite.native-v7.config.ts",
  "scripts/preact-pack-browser-v4.mjs",
  "tests/preact-pack-api-v4.test.ts",
  "evaluation/PREACT_PACK_BROWSER_V4.md",
];
export const browserV4Settings = {
  format: "repolab-preact-browser-qualification/v4",
  parentReviewerFreeze:
    "bb4d209f0de115bda1c721f0aee9864464df3c19c756d1267456ced96f3b9efa",
  originRunId: "f8bfb85d-6766-4a9e-a762-e362d011559c",
  sourceHash:
    "68c9000eec6e0ed71f140c8af231309064d1e7447414f00136cbb91b4e3eb0d3",
  packDigest:
    "986ae095cd7224c608b19cfd8d4e00a33dcc779a858fc79faf6a6c5468a5b841",
  api: "/api/native-selected-v4",
  browser: "/selected-pack-v4.html",
  qualificationSlots: 1,
  qualificationRetry: false,
  sandboxOperations: 14,
  inferenceCalls: 0,
  independentInputsExported: 0,
  keylessRestart: true,
  viewports: [1440, 390, 320],
  scope:
    "browser file import and API native replay; same machine/project and qualified cached image",
};
export function browserV4Bytes(path: string) {
  const b = readFileSync(path);
  return path === browserV4Assets[0]
    ? Buffer.from(
        b.toString().replace(BROWSER_V4_FREEZE, "__BROWSER_V4_FREEZE__"),
      )
    : b;
}
export function auditPreactBrowserV4(reader = browserV4Bytes) {
  auditNativeReviewerV2();
  const p = JSON.parse(
      readFileSync("evaluation/preact-browser-v4.json", "utf8"),
    ),
    { digest, assets, ...settings } = p;
  if (
    digest !== BROWSER_V4_FREEZE ||
    JSON.stringify(settings) !== JSON.stringify(browserV4Settings) ||
    shaNative(JSON.stringify({ ...settings, assets })) !== digest ||
    assets.length !== browserV4Assets.length ||
    assets.some(
      (a: any, i: number) =>
        a.path !== browserV4Assets[i] || a.sha256 !== shaNative(reader(a.path)),
    )
  )
    throw Error("Preact browser v4 freeze changed");
  return p;
}
