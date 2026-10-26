import { readFileSync } from "node:fs";
import { crossSha } from "../execution/cross-repo-sandbox-v1.ts";
import {
  githubAnchorAssets as parentAssets,
  auditGithubAnchors as auditParent,
} from "./github-anchor-protocol-v2.ts";

export const GITHUB_REPAIR_FREEZE = "ea481953dc20eec5fcb01a9ff2e4ea565852d1e208b8b31aa4f616da2ee01580";
export const githubRepairSettings = {
  format: "repolab-github-anchor-repair/v3",
  parentFreeze:
    "e199e3ea99b62b5e049ea76f333b0f2893cb09ba3da91b857c3d23a85f4481df",
  tasks: ["klona", "dequal", "regexparam"],
  model: "nvidia/nemotron-3-super-120b-a12b",
  requestBytes: 64000,
  outputTokens: 16384,
  maxCandidates: 2,
  maxModelCalls: 6,
  maxSandboxOperations: 36,
  operationsPerTask: 12,
  monetaryCap: null,
  automaticProviderRetry: false,
  publicRepeats: 2,
  nativeRepeats: 2,
  independentRepeats: 2,
  productionPromotion: false,
  baselines: [
    {
      task: "klona",
      resultSha256:
        "b8a11037d2220c3aa39e867ced62eb45d07bce8f46cbf3ac775d6fc169b16b81",
    },
    {
      task: "dequal",
      resultSha256:
        "186e6499060d49b7cfc74f52d4a3ce1c03a84b72e5597a6e7a85ff7b479a7bba",
    },
    {
      task: "regexparam",
      resultSha256:
        "e0b0d376d30cb2c5e742e03a4524cae1de24443a11120e231e3ccd10977805ca",
    },
  ],
  scope:
    "Fixed three-task same-maintainer GitHub development trial after V1/V2 qualification. Reporter suggestions exposed in original issue bodies. Not random, controller-blind or training-unseen. Preserve all selected tasks and failures; no tuning after post-selection independent evaluation.",
};
export const githubRepairAssets = [
  "packages/repositories/github-anchor-protocol-v3.ts",
  "packages/repositories/github-anchor-v3.ts",
  "apps/repositories/github-anchor-v3.ts",
  "tests/github-anchor-v3.test.ts",
  "evaluation/GITHUB_ANCHOR_V3.md",
  "evaluation/github-anchor-v2.json",
  ...parentAssets,
];
export function githubRepairAssetBytes(path: string) {
  const b = readFileSync(path);
  return path === githubRepairAssets[0]
    ? Buffer.from(
        b.toString().replace(GITHUB_REPAIR_FREEZE, "__GITHUB_REPAIR_FREEZE__"),
      )
    : b;
}
export function auditGithubRepairProtocol(reader = githubRepairAssetBytes) {
  auditParent();
  const { digest, assets, ...settings } = JSON.parse(
    readFileSync("evaluation/github-anchor-v3.json", "utf8"),
  );
  if (
    digest !== GITHUB_REPAIR_FREEZE ||
    JSON.stringify(settings) !== JSON.stringify(githubRepairSettings) ||
    crossSha(JSON.stringify({ ...settings, assets })) !== digest ||
    assets.length !== githubRepairAssets.length ||
    assets.some(
      (a: any, i: number) =>
        a.path !== githubRepairAssets[i] ||
        a.sha256 !== crossSha(reader(a.path)),
    )
  )
    throw Error("GitHub anchor prospective freeze changed");
  return { digest, assets, ...settings };
}
