import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { auditFreshPilotV3 } from "./fresh-pilot-protocol-v3.ts";
export const FRESH_V4_FREEZE = "0dcf53e9f6064a2b7828a6767b3bbde1d00ecf85722142983c63b76b6231028e";
export const crossSettings = {
  format: "repolab-public-api-development/v4",
  parentPreparationFreeze:
    "ceffa37d67203091c4387f481a9a70459f640327e77ff7256ebad1cfd8d79644",
  tasks: ["minimistjs__minimist-47", "sindresorhus__camelcase-117"],
  model: "nvidia/nemotron-3-super-120b-a12b",
  requestPolicy: "nemotron-full-thinking-v1",
  ratesUsdPerMillion: { input: 0.3, output: 0.9 },
  sourceRepresentation:
    "explicit tabs/spaces/text atoms decoded to exact pinned-original blocks v3",
  runtimePolicy:
    "Node 24 from configured Sandbox image; camelcase CI declares Node 24; original commands retained",
  apiCoverage: {
    minimist: 10,
    camelcase: 24,
    fastifyDeepmerge: "static contract block",
  },
  nativeNetworking:
    "minimist native command includes online aud --production; native-only exception; all public/independent observations offline",
  maxCandidatesPerTask: 4,
  maxOperationsPerTask: 26,
  modelRequestBytes: 64000,
  monetaryCap: null,
  originalPublicRepeats: 2,
  selectedPublicRepeats: 2,
  selectedNativeRepeats: 2,
  independentRepeats: 2,
  operationResubmission: false,
  taskReplacementAfterOutcomes: false,
  scope:
    "two exposed development tasks after V3 exact-block generation and full-body budget failures; V2 fresh 0/3 and V3 development 0/2 retained; no fresh-task generalization claim",
};
export const crossAssets = [
  "packages/repositories/fresh-pilot-protocol-v4.ts",
  "packages/repositories/fresh-pilot-v4.ts",
  "packages/repositories/public-api-inventory-v1.ts",
  "packages/repositories/fresh-context-v2.ts",
  "packages/repositories/source-edits-v3.ts",
  "packages/repositories/fresh-generation-v4.ts",
  "packages/providers/nebius-thinking-v2.ts",
  "packages/repositories/cross-runtime-v2.ts",
  "packages/execution/cross-repo-sandbox-v1.ts",
  "packages/execution/fresh-native-signature-v1.ts",
  "packages/execution/fresh-request-v1.ts",
  "packages/evaluation/fresh-pilot-cases-v1.ts",
  "repositories/fresh-pilot-v3/driver.cjs",
  "repositories/cross-repo-v1/child.cjs",
  "apps/repositories/fresh-pilot-v4.ts",
  "tests/fresh-pilot-v4.test.ts",
  "evaluation/FRESH_PILOT_V4.md",
  "evaluation/fresh-pilot-selection-v1.json",
  "evaluation/fresh-pilot-v4-baselines.json",
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
    ? Buffer.from(b.toString().replace(FRESH_V4_FREEZE, "__FRESH_V4_FREEZE__"))
    : b;
}
export function auditFreshPilotV4(reader = crossAssetBytes) {
  auditFreshPilotV3();
  const p = JSON.parse(readFileSync("evaluation/fresh-pilot-v4.json", "utf8")),
    { digest, assets, ...settings } = p;
  const sha = (b: string | Buffer) =>
    createHash("sha256").update(b).digest("hex");
  if (
    digest !== FRESH_V4_FREEZE ||
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
