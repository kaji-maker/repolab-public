import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { auditPreactBrowserV4 } from "./preact-browser-protocol-v4.ts";
export const CROSS_V1_FREEZE = "84699931863b63e57c67578e8e0eb2d42e0a3019cfd6d3848681080b1d7496f1";
export const crossSettings = {
  format: "repolab-cross-repository-protocol/v1",
  parentBrowserFreeze:
    "4d211611dc902224615bf6f03c98e937630969565ee53f593464e86258e7eafc",
  tasks: [
    "epoberezkin__fast-deep-equal-141",
    "davidmarkclements__rfdc-55",
    "epoberezkin__fast-json-stable-stringify-74",
  ],
  model: "nvidia/nemotron-3-super-120b-a12b",
  requestPolicy: "nemotron-full-thinking-v1",
  ratesUsdPerMillion: { input: 0.3, output: 0.9 },
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
    "three purposively selected small CommonJS libraries; new to ReproLab execution, public and not training-unseen or a blinded controller assessment",
};
export const crossAssets = [
  "packages/repositories/cross-repo-protocol-v1.ts",
  "packages/repositories/cross-repo-v1.ts",
  "packages/execution/cross-repo-sandbox-v1.ts",
  "packages/evaluation/cross-repo-cases-v1.ts",
  "repositories/cross-repo-v1/driver.cjs",
  "repositories/cross-repo-v1/child.cjs",
  "apps/repositories/cross-repo-v1.ts",
  "tests/cross-repo-v1.test.ts",
  "evaluation/CROSS_REPOSITORY_V1.md",
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
    ? Buffer.from(b.toString().replace(CROSS_V1_FREEZE, "__CROSS_V1_FREEZE__"))
    : b;
}
export function auditCrossRepoV1(reader = crossAssetBytes) {
  auditPreactBrowserV4();
  const p = JSON.parse(
      readFileSync("evaluation/cross-repository-v1.json", "utf8"),
    ),
    { digest, assets, ...settings } = p;
  const sha = (b: string | Buffer) =>
    createHash("sha256").update(b).digest("hex");
  if (
    digest !== CROSS_V1_FREEZE ||
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
