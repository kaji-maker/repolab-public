import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { auditCrossRepoV2 } from "./cross-repo-protocol-v2.ts";
export const CROSS_V3_FREEZE = "4fc30e32ffa06944283ce14e78e5ff56a35ce0ba6acb77743b25fbeaa7b0937f";
export const crossSettings = {
  format: "repolab-cross-repository-development/v3",
  parentPreparationFreeze:
    "314bd7aa389f900a5bcc6571f7b14498d84e384a8fd4549c2c3272b14d4f2d12",
  tasks: [
    "epoberezkin__fast-deep-equal-141",
    "davidmarkclements__rfdc-55",
    "epoberezkin__fast-json-stable-stringify-74",
  ],
  model: "nvidia/nemotron-3-super-120b-a12b",
  requestPolicy: "nemotron-full-thinking-v1",
  ratesUsdPerMillion: { input: 0.3, output: 0.9 },
  sourceRepresentation: "pinned-original exact line edits v1",
  runtimePolicy:
    "rfdc Node 22.15.0 checksum verified; other tasks original Node 24",
  maxCandidatesPerTask: 2,
  maxOperationsPerTask: 20,
  modelRequestBytes: 32000,
  monetaryCap: null,
  originalPublicRepeats: 2,
  selectedPublicRepeats: 2,
  selectedNativeRepeats: 2,
  independentRepeats: 2,
  operationResubmission: false,
  taskReplacementAfterOutcomes: false,
  scope:
    "three previously exposed development tasks; excluded from the preserved zero-score pilot and any unseen-task denominator",
};
export const crossAssets = [
  "packages/repositories/cross-repo-protocol-v3.ts",
  "packages/repositories/cross-repo-v3.ts",
  "packages/repositories/source-edits-v1.ts",
  "packages/repositories/cross-runtime-v1.ts",
  "packages/execution/cross-repo-sandbox-v1.ts",
  "packages/evaluation/cross-repo-cases-v1.ts",
  "repositories/cross-repo-v3/driver.cjs",
  "repositories/cross-repo-v1/child.cjs",
  "apps/repositories/cross-repo-v3.ts",
  "tests/cross-repo-v3.test.ts",
  "evaluation/CROSS_REPOSITORY_V3.md",
  "evaluation/cross-repository-selection-v1.json",
  ...["fast-deep-equal", "rfdc", "fast-json-stable-stringify"].flatMap((n) =>
    ["manifest.json", "original.tar.gz", "LICENSE"].map(
      (p) => "repositories/cross-repo-v1/" + n + "/" + p,
    ),
  ),
];
export function crossAssetBytes(path: string) {
  const b = readFileSync(path);
  return path === crossAssets[0]
    ? Buffer.from(b.toString().replace(CROSS_V3_FREEZE, "__CROSS_V3_FREEZE__"))
    : b;
}
export function auditCrossRepoV3(reader = crossAssetBytes) {
  auditCrossRepoV2();
  const p = JSON.parse(
      readFileSync("evaluation/cross-repository-v3.json", "utf8"),
    ),
    { digest, assets, ...settings } = p;
  const sha = (b: string | Buffer) =>
    createHash("sha256").update(b).digest("hex");
  if (
    digest !== CROSS_V3_FREEZE ||
    JSON.stringify(settings) !== JSON.stringify(crossSettings) ||
    sha(JSON.stringify({ ...settings, assets })) !== digest ||
    assets.length !== crossAssets.length ||
    assets.some(
      (a: any, i: number) =>
        a.path !== crossAssets[i] || a.sha256 !== sha(reader(a.path)),
    )
  )
    throw Error("Cross-repository prospective freeze changed");
  return p;
}
