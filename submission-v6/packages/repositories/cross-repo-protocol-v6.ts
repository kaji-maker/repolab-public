import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { auditCrossRepoV5 } from "./cross-repo-protocol-v5.ts";
export const CROSS_V6_FREEZE = "d5ab96c21723d0e2dfa792e876f14b1a9b783a3d3619e62f0caa268aae2761c8";
export const crossSettings = {
  format: "repolab-cross-repository-development/v6",
  parentPreparationFreeze:
    "d2df5dac195935c83b8978b7f792303c2fb0d58a0c2aaf2eed6f6b1a690541e8",
  tasks: ["davidmarkclements__rfdc-55"],
  model: "nvidia/nemotron-3-super-120b-a12b",
  requestPolicy: "nemotron-full-thinking-v1",
  ratesUsdPerMillion: { input: 0.3, output: 0.9 },
  sourceRepresentation:
    "pinned-original exact text blocks with verified match counts v2",
  runtimePolicy:
    "rfdc Node 20.9.0 checksum verified; other tasks original Node 24",
  qualificationSource: ".repolab/cross-repo-development-v5/rfdc/qualify.json",
  qualificationFreeze:
    "d2df5dac195935c83b8978b7f792303c2fb0d58a0c2aaf2eed6f6b1a690541e8",
  qualificationSha256:
    "0e70b9680f9f59a0303bf544098bfb81f5ea45a28854ba05b1d6d2e2802dd9a8",
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
    "rfdc exposed development retry after two rejected coordinate proposals; all V5 results and the original zero-score pilot preserved",
};
export const crossAssets = [
  "packages/repositories/cross-repo-protocol-v6.ts",
  "packages/repositories/cross-repo-v6.ts",
  "packages/repositories/source-edits-v2.ts",
  "packages/repositories/cross-runtime-v2.ts",
  "packages/execution/cross-repo-sandbox-v1.ts",
  "packages/evaluation/cross-repo-cases-v1.ts",
  "repositories/cross-repo-v5/driver.cjs",
  "repositories/cross-repo-v1/child.cjs",
  "apps/repositories/cross-repo-v6.ts",
  "tests/cross-repo-v6.test.ts",
  "evaluation/CROSS_REPOSITORY_V6.md",
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
    ? Buffer.from(b.toString().replace(CROSS_V6_FREEZE, "__CROSS_V6_FREEZE__"))
    : b;
}
export function auditCrossRepoV6(reader = crossAssetBytes) {
  auditCrossRepoV5();
  const p = JSON.parse(
      readFileSync("evaluation/cross-repository-v6.json", "utf8"),
    ),
    { digest, assets, ...settings } = p;
  const sha = (b: string | Buffer) =>
    createHash("sha256").update(b).digest("hex");
  if (
    digest !== CROSS_V6_FREEZE ||
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
