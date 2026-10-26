import { readFileSync } from "node:fs";
import { crossSha } from "../execution/cross-repo-sandbox-v1.ts";
import {
  githubLoadAssets,
  auditGithubLoadProtocol,
} from "../repositories/github-anchor-protocol-v4.ts";
export const FAILURE_INTEGRITY_FREEZE = "aa800942aa4c3eeec3601eb9ce3c82ee8bb38adbaa144ba331c1a730939a76b7";
export const failureIntegritySettings = {
  format: "repolab-failure-integrity-qualification/v1",
  maxModelCalls: 0,
  maxSandboxOperations: 4,
  operations: [
    "fixture-stage",
    "fixture-load",
    "fixture-controls",
    "fixture-cancel",
  ],
  fixtureTail: '\nthrow new Error("REPOLAB_REVIEWED_LOAD_FAILURE");\n',
  cancellationProgram:
    "const until=Date.now()+5000;while(Date.now()<until){};return 17;",
  portableManifestSha256:
    "b067b367f415bd3bf7b5dc2be79ac98937d9f34ed6194301915ca81867e765c0",
  scope:
    "Reviewed controller-authored fixtures only; zero inference. Qualifies opt-in guarded transport and shared candidate-gate orchestration. Historical repair protocols/defaults remain unchanged.",
};
export const failureIntegrityAssets = [
  ...new Set([
    "packages/evaluation/failure-integrity-protocol-v1.ts",
    "packages/execution/guarded-cross-sandbox-v1.ts",
    "packages/controller/candidate-gates-v1.ts",
    "packages/repositories/portable-module-qualification-v1.ts",
    "apps/evaluator/failure-integrity-v1.ts",
    "tests/failure-integrity-v1.test.ts",
    "tests/portable-module-qualification-v1.test.ts",
    "evaluation/FAILURE_INTEGRITY_V1.md",
    "evaluation/module-admission-portable-v1.json",
    "evaluation/github-anchor-v4.json",
    ...githubLoadAssets,
  ]),
];
export function failureIntegrityAssetBytes(path: string) {
  const bytes = readFileSync(path);
  return path === failureIntegrityAssets[0]
    ? Buffer.from(
        bytes
          .toString()
          .replace(FAILURE_INTEGRITY_FREEZE, "__FAILURE_INTEGRITY_FREEZE__"),
      )
    : bytes;
}
export function auditFailureIntegrity(reader = failureIntegrityAssetBytes) {
  auditGithubLoadProtocol();
  const { digest, assets, ...settings } = JSON.parse(
    readFileSync("evaluation/failure-integrity-v1.json", "utf8"),
  );
  if (
    digest !== FAILURE_INTEGRITY_FREEZE ||
    JSON.stringify(settings) !== JSON.stringify(failureIntegritySettings) ||
    crossSha(JSON.stringify({ ...settings, assets })) !== digest ||
    assets.length !== failureIntegrityAssets.length ||
    assets.some(
      (f: any, i: number) =>
        f.path !== failureIntegrityAssets[i] ||
        f.sha256 !== crossSha(reader(f.path)),
    )
  )
    throw Error("Failure-integrity prospective freeze changed");
  return { digest, assets, ...settings };
}
