import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { auditFreshPilotV2 } from "./fresh-pilot-protocol-v2.ts";
export const FRESH_V3_FREEZE = "ceffa37d67203091c4387f481a9a70459f640327e77ff7256ebad1cfd8d79644";
export const crossSettings = {
  format: "repolab-public-api-development/v3",
  parentPreparationFreeze:
    "4b3351455f1d55d7b272a0d4ee5ea666a1d3812e1c8e71107bde44ffdefc8631",
  tasks: ["minimistjs__minimist-47", "sindresorhus__camelcase-117"],
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
    "two exposed development tasks after native cache setup failures; V2 selected-three zero-score result retained; no new-task generalization claim",
};
export const crossAssets = [
  "packages/repositories/fresh-pilot-protocol-v3.ts",
  "packages/repositories/fresh-pilot-v3.ts",
  "packages/repositories/public-api-inventory-v1.ts",
  "packages/repositories/fresh-context-v2.ts",
  "packages/repositories/source-edits-v2.ts",
  "packages/repositories/cross-runtime-v2.ts",
  "packages/execution/cross-repo-sandbox-v1.ts",
  "packages/execution/fresh-native-signature-v1.ts",
  "packages/execution/fresh-request-v1.ts",
  "packages/evaluation/fresh-pilot-cases-v1.ts",
  "repositories/fresh-pilot-v3/driver.cjs",
  "repositories/cross-repo-v1/child.cjs",
  "apps/repositories/fresh-pilot-v3.ts",
  "tests/fresh-pilot-v3.test.ts",
  "evaluation/FRESH_PILOT_V3.md",
  "evaluation/fresh-pilot-selection-v1.json",
  "evaluation/fresh-pilot-v3-baselines.json",
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
    ? Buffer.from(b.toString().replace(FRESH_V3_FREEZE, "__FRESH_V3_FREEZE__"))
    : b;
}
export function auditFreshPilotV3(reader = crossAssetBytes) {
  auditFreshPilotV2();
  const p = JSON.parse(readFileSync("evaluation/fresh-pilot-v3.json", "utf8")),
    { digest, assets, ...settings } = p;
  const sha = (b: string | Buffer) =>
    createHash("sha256").update(b).digest("hex");
  if (
    digest !== FRESH_V3_FREEZE ||
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
