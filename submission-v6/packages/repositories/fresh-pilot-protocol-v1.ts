import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { auditCrossRepoV6 } from "./cross-repo-protocol-v6.ts";
export const FRESH_V1_FREEZE = "e22731c6df14611cf830f7eeffea2f49d8b2de87b3bce5b4f87b0a5c0ff9a9c7";
export const crossSettings = {
  format: "repolab-fresh-repository-pilot/v1",
  parentPreparationFreeze:
    "d5ab96c21723d0e2dfa792e876f14b1a9b783a3d3619e62f0caa268aae2761c8",
  tasks: [
    "minimistjs__minimist-47",
    "sindresorhus__camelcase-117",
    "fastify__deepmerge-81",
  ],
  model: "nvidia/nemotron-3-super-120b-a12b",
  requestPolicy: "nemotron-full-thinking-v1",
  ratesUsdPerMillion: { input: 0.3, output: 0.9 },
  sourceRepresentation:
    "pinned-original exact text blocks with verified match counts v2",
  runtimePolicy:
    "Node 24 from configured Sandbox image; camelcase CI declares Node 24; original commands retained",
  apiCoverage: {
    minimist: 10,
    camelcase: 24,
    fastifyDeepmerge: "static contract block",
  },
  nativeNetworking:
    "minimist native command includes online aud --production; native-only exception; all public/independent observations offline",
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
    "fixed three public issue snapshots new to ReproLab execution; purposive sample, original reporter hints included, training exposure unknown; no task replacement after outcomes",
};
export const crossAssets = [
  "packages/repositories/fresh-pilot-protocol-v1.ts",
  "packages/repositories/fresh-pilot-v1.ts",
  "packages/repositories/public-api-inventory-v1.ts",
  "packages/repositories/fresh-context-v1.ts",
  "packages/repositories/source-edits-v2.ts",
  "packages/repositories/cross-runtime-v2.ts",
  "packages/execution/cross-repo-sandbox-v1.ts",
  "packages/execution/fresh-native-signature-v1.ts",
  "packages/execution/fresh-request-v1.ts",
  "packages/evaluation/fresh-pilot-cases-v1.ts",
  "repositories/fresh-pilot-v1/driver.cjs",
  "repositories/cross-repo-v1/child.cjs",
  "apps/repositories/fresh-pilot-v1.ts",
  "tests/fresh-pilot-v1.test.ts",
  "evaluation/FRESH_PILOT_V1.md",
  "evaluation/fresh-pilot-selection-v1.json",
  ...["minimist", "camelcase", "fastify-deepmerge"].flatMap((n) =>
    [
      "manifest.json",
      "original.tar.gz",
      "LICENSE",
      "api-inventory.json",
      "public-cases.json",
      "independent-cases.json",
    ].map((p) => "repositories/fresh-pilot-v1/" + n + "/" + p),
  ),
];

export function crossAssetBytes(path: string) {
  const b = readFileSync(path);
  return path === crossAssets[0]
    ? Buffer.from(b.toString().replace(FRESH_V1_FREEZE, "__FRESH_V1_FREEZE__"))
    : b;
}
export function auditFreshPilotV1(reader = crossAssetBytes) {
  auditCrossRepoV6();
  const p = JSON.parse(readFileSync("evaluation/fresh-pilot-v1.json", "utf8")),
    { digest, assets, ...settings } = p;
  const sha = (b: string | Buffer) =>
    createHash("sha256").update(b).digest("hex");
  if (
    digest !== FRESH_V1_FREEZE ||
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
