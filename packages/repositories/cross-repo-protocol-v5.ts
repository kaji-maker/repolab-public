import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { auditCrossRepoV4 } from "./cross-repo-protocol-v4.ts";
export const CROSS_V5_FREEZE = "d2df5dac195935c83b8978b7f792303c2fb0d58a0c2aaf2eed6f6b1a690541e8";
export const crossSettings = {
  format: "repolab-cross-repository-development/v5",
  parentPreparationFreeze:
    "3196db7c1d52d3001e0ad078699d106a5beeb3ab7df8ffd5977df015efe50cd7",
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
    "rfdc Node 20.9.0 checksum verified; other tasks original Node 24",
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
  "packages/repositories/cross-repo-protocol-v5.ts",
  "packages/repositories/cross-repo-v5.ts",
  "packages/repositories/source-edits-v1.ts",
  "packages/repositories/cross-runtime-v2.ts",
  "packages/execution/cross-repo-sandbox-v1.ts",
  "packages/evaluation/cross-repo-cases-v1.ts",
  "repositories/cross-repo-v5/driver.cjs",
  "repositories/cross-repo-v1/child.cjs",
  "apps/repositories/cross-repo-v5.ts",
  "tests/cross-repo-v5.test.ts",
  "evaluation/CROSS_REPOSITORY_V5.md",
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
    ? Buffer.from(b.toString().replace(CROSS_V5_FREEZE, "__CROSS_V5_FREEZE__"))
    : b;
}
export function auditCrossRepoV5(reader = crossAssetBytes) {
  auditCrossRepoV4();
  const p = JSON.parse(
      readFileSync("evaluation/cross-repository-v5.json", "utf8"),
    ),
    { digest, assets, ...settings } = p;
  const sha = (b: string | Buffer) =>
    createHash("sha256").update(b).digest("hex");
  if (
    digest !== CROSS_V5_FREEZE ||
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
