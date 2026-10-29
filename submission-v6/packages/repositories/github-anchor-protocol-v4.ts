import { readFileSync } from "node:fs";
import { crossSha } from "../execution/cross-repo-sandbox-v1.ts";
import {
  githubRepairAssets as parentAssets,
  auditGithubRepairProtocol as auditParent,
  GITHUB_REPAIR_FREEZE as PARENT_FREEZE,
} from "./github-anchor-protocol-v3.ts";

export const GITHUB_LOAD_FREEZE = "95b625f18bdce7e152fe371d28cb3eb0303217ebf3c0a827a90870a30559cbf0";
/**
 * V4 adds static source admission and Sandbox module-load admission before behavior.
 * Only regexparam is eligible: klona and dequal completed independent evaluation in V3.
 */
export const githubLoadSettings = {
  format: "repolab-github-anchor-repair/v4",
  parentFreeze: PARENT_FREEZE,
  tasks: ["regexparam"],
  model: "nvidia/nemotron-3-super-120b-a12b",
  requestBytes: 64000,
  outputTokens: 16384,
  maxCandidates: 2,
  maxModelCalls: 2,
  // q-load + 2 x (stage, load, public A/B, native A/B) + independent A/B.
  operationsPerTask: 15,
  maxSandboxOperations: 15,
  monetaryCap: null,
  automaticProviderRetry: false,
  staticAdmission: "typescript-checkjs-syntax-and-regex/v1",
  loadAdmission: "require-every-package-runtime-entry/v1",
  qualification: {
    freeze: "c91ab1f49096ce6fa753fde0b3b60a932616e952ab7a0d7e323294313fbc645c",
    resultPath: ".repolab/module-qualification-v1/regexparam/result.json",
    resultSha256:
      "9303f90c1049b9342018eace667e1739ade52c09c1cf8992bdee912fc23ddc2e",
  },
  publicRepeats: 2,
  nativeRepeats: 2,
  independentRepeats: 2,
  productionPromotion: false,
  priorAttempts: [
    {
      task: "regexparam",
      protocol: "v3",
      status: "ABSTAINED_NO_SELECTION",
      resultPath: ".repolab/github-anchor-v3/regexparam/result.json",
    },
  ],
  scope:
    "Development follow-up for one same-maintainer GitHub task after a measured V3 module-load failure. The task, issue and public checks were exposed in V3; independent cases remain unopened. Not fresh, random, controller-blind or training-unseen. Preserve V3 results and all failures.",
};
export const githubLoadAssets = [
  "packages/repositories/github-anchor-protocol-v4.ts",
  "packages/repositories/github-anchor-v4.ts",
  "packages/repositories/module-admission-v1.ts",
  "apps/repositories/github-anchor-v4.ts",
  "tests/github-anchor-v4.test.ts",
  "tests/module-admission-v1.test.ts",
  "evaluation/GITHUB_ANCHOR_V4.md",
  "evaluation/module-qualification-v1.json",
  "packages/repositories/module-qualification-v1.ts",
  "evaluation/github-anchor-v3.json",
  ...parentAssets,
];
export function githubLoadAssetBytes(path: string) {
  const b = readFileSync(path);
  return path === githubLoadAssets[0]
    ? Buffer.from(
        b.toString().replace(GITHUB_LOAD_FREEZE, "__GITHUB_LOAD_FREEZE__"),
      )
    : b;
}
export function githubLoadFreezeRecord(reader = githubLoadAssetBytes) {
  const assets = githubLoadAssets.map((path) => ({
      path,
      sha256: crossSha(reader(path)),
    })),
    digest = crossSha(JSON.stringify({ ...githubLoadSettings, assets }));
  return { digest, ...githubLoadSettings, assets };
}
/** The private qualification result must exist, match its bound hash and report a pass. */
export function assertLoadQualification(
  reader = (path: string) => readFileSync(path),
) {
  const q = githubLoadSettings.qualification;
  let result: any;
  try {
    const bytes = reader(q.resultPath);
    if (crossSha(bytes) !== q.resultSha256) throw Error();
    result = JSON.parse(bytes.toString());
  } catch {
    throw Error("Module admission qualification required");
  }
  if (result.status !== "QUALIFIED" || result.freeze !== q.freeze)
    throw Error("Module admission qualification required");
}
export function auditGithubLoadProtocol(reader = githubLoadAssetBytes) {
  auditParent();
  if (!/^[a-f0-9]{64}$/.test(GITHUB_LOAD_FREEZE))
    throw Error("GitHub load protocol is not frozen");
  assertLoadQualification();
  const { digest, assets, ...settings } = JSON.parse(
    readFileSync("evaluation/github-anchor-v4.json", "utf8"),
  );
  if (
    digest !== GITHUB_LOAD_FREEZE ||
    JSON.stringify(settings) !== JSON.stringify(githubLoadSettings) ||
    crossSha(JSON.stringify({ ...settings, assets })) !== digest ||
    assets.length !== githubLoadAssets.length ||
    assets.some(
      (a: any, i: number) =>
        a.path !== githubLoadAssets[i] ||
        a.sha256 !== crossSha(reader(a.path)),
    )
  )
    throw Error("GitHub load prospective freeze changed");
  return { digest, assets, ...settings };
}
