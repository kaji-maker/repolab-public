import { readFileSync } from "node:fs";
import { crossSha } from "../execution/cross-repo-sandbox-v1.ts";
import {
  semanticAssets,
  auditSemanticPlan,
} from "./semantic-plan-protocol-v2.ts";

export const GITHUB_ANCHOR_FREEZE = "a366368d80c9f2a6ea6c8fe5d8f21cb3479ae6479c984187a43992f776523008";
export const githubAnchorSettings = {
  format: "repolab-github-anchor-preparation/v1",
  parentFreeze:
    "315812db5047a4e8af247fdcfd23c8feeff1288fa5abe9dc4382fcd3d40a46e4",
  tasks: ["klona", "dequal", "regexparam"],
  model: "nvidia/nemotron-3-super-120b-a12b",
  requestBytes: 64000,
  outputTokens: 16384,
  maxModelCalls: 0,
  maxSandboxOperations: 18,
  operationsPerTask: 6,
  monetaryCap: null,
  automaticProviderRetry: false,
  runtime:
    "configured Node 24 image; historical CI uses Node 8–16; incompatibility stays blocked without runtime changes",
  networking:
    "dependency installation only; no lifecycle scripts; build/native/public/control phases offline",
  publicRepeats: 2,
  independentOpened: false,
  productionPromotion: false,
  scope:
    "purposive three-task public GitHub preparation and original environment qualification; new to ReproLab execution, same maintainer; reporter suggestions exposed in issue bodies; no random, controller-blind or training-unseen claim; no model repair in this phase",
};
export const githubAnchorAssets = [
  "packages/repositories/github-anchor-protocol-v1.ts",
  "packages/repositories/github-anchor-v1.ts",
  "apps/repositories/github-anchor-v1.ts",
  "tests/github-anchor-v1.test.ts",
  "evaluation/GITHUB_ANCHOR_V1.md",
  ...githubAnchorSettings.tasks.flatMap((name) => {
    const base = "repositories/github-anchor-v1/" + name,
      m = JSON.parse(readFileSync(base + "/manifest.json", "utf8"));
    return [
      "manifest.json",
      "original.tar.gz",
      "public-cases.json",
      "independent-cases.json",
      ...Object.keys(m.files)
        .sort()
        .map((p) => "original/" + p),
    ].map((p) => base + "/" + p);
  }),
  ...semanticAssets,
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
  auditSemanticPlan();
  const { digest, assets, ...settings } = JSON.parse(
    readFileSync("evaluation/github-anchor-v1.json", "utf8"),
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
