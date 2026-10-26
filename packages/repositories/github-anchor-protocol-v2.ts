import { readFileSync } from "node:fs";
import { crossSha } from "../execution/cross-repo-sandbox-v1.ts";
import {
  githubAnchorAssets as parentAssets,
  auditGithubAnchors as auditParent,
} from "./github-anchor-protocol-v1.ts";

export const GITHUB_ANCHOR_FREEZE = "e199e3ea99b62b5e049ea76f333b0f2893cb09ba3da91b857c3d23a85f4481df";
export const githubAnchorSettings = {
  format: "repolab-github-anchor-preparation/v2",
  parentFreeze:
    "a366368d80c9f2a6ea6c8fe5d8f21cb3479ae6479c984187a43992f776523008",
  tasks: ["klona", "dequal", "regexparam"],
  model: "nvidia/nemotron-3-super-120b-a12b",
  requestBytes: 64000,
  outputTokens: 16384,
  maxModelCalls: 0,
  maxSandboxOperations: 18,
  operationsPerTask: 6,
  monetaryCap: null,
  automaticProviderRetry: false,
  nativeRuntime: {
    version: "v12.22.12",
    url: "https://nodejs.org/download/release/v12.22.12/node-v12.22.12-linux-x64.tar.gz",
    sha256: "ff92a45c4d03e8e270bec1ab337b8fff6e9de293dabfe7e8936a41f2fb0b202e",
  },
  runtime:
    "root supervisor and syntax checker Node 24; pinned historical CI Node 12.22.12 for dependencies/build/unchanged native; permission-constrained public/control children Node 24",
  networking:
    "dependency installation only; no lifecycle scripts; build/native/public/control phases offline",
  publicRepeats: 2,
  independentOpened: false,
  productionPromotion: false,
  scope:
    "same three selected GitHub tasks; exposed environment recovery after V1 native-loader failures; same maintainer; reporter suggestions exposed in issue bodies; no random, controller-blind or training-unseen claim; zero model repairs in this preparation phase",
};
export const githubAnchorAssets = [
  "packages/repositories/github-anchor-protocol-v2.ts",
  "packages/repositories/github-anchor-v2.ts",
  "repositories/github-anchor-v2/driver.cjs",
  "apps/repositories/github-anchor-v2.ts",
  "tests/github-anchor-v2.test.ts",
  "evaluation/GITHUB_ANCHOR_V2.md",
  ...parentAssets,
];
export function githubAnchorAssetBytes(path: string) {
  const b = readFileSync(path);
  return path === githubAnchorAssets[0]
    ? Buffer.from(
        b.toString().replace(GITHUB_ANCHOR_FREEZE, "__GITHUB_ANCHOR_FREEZE__"),
      )
    : b;
}
export function auditGithubAnchors(reader = githubAnchorAssetBytes) {
  auditParent();
  const { digest, assets, ...settings } = JSON.parse(
    readFileSync("evaluation/github-anchor-v2.json", "utf8"),
  );
  if (
    digest !== GITHUB_ANCHOR_FREEZE ||
    JSON.stringify(settings) !== JSON.stringify(githubAnchorSettings) ||
    crossSha(JSON.stringify({ ...settings, assets })) !== digest ||
    assets.length !== githubAnchorAssets.length ||
    assets.some(
      (a: any, i: number) =>
        a.path !== githubAnchorAssets[i] ||
        a.sha256 !== crossSha(reader(a.path)),
    )
  )
    throw Error("GitHub anchor prospective freeze changed");
  return { digest, assets, ...settings };
}
