import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import {
  literalAssets,
  auditLiteralSerializer,
} from "./serializer-literal-protocol-v1.ts";
export const SEMANTIC_FREEZE = "9d1838058080bad645aa65856ec86952721d9df5c62a66a6ffc2ad29378215e6";
export const semanticSettings = {
  format: "repolab-semantic-plan-integration/v1",
  parentFreeze:
    "2c61c149e27dd4d0a45e90ba371a365c90b6ac481e57cbb56fde9f77ae9013dd",
  fixtures: ["count-window", "nullish-default", "option-default"],
  model: "nvidia/nemotron-3-super-120b-a12b",
  requestPolicy:
    "full-thinking; schema in system and response_format; readable original source",
  outputTokens: 16384,
  requestBytes: 64000,
  ratesUsdPerMillion: { input: 0.3, output: 0.9 },
  maxCandidates: 2,
  maxModelCalls: 6,
  maxSandboxOperations: 51,
  qualificationOperationsPerFixture: 5,
  repairOperationsPerFixture: 12,
  publicRepeats: 2,
  nativeRepeats: 2,
  independentRepeats: 2,
  allGuestNetworking: false,
  monetaryCap: null,
  automaticProviderRetry: false,
  productionPromotion: false,
  scope:
    "three controller-authored semantic repair integration fixtures; independent cases withheld from model until after source selection; no fresh GitHub or unseen-bug score claim",
};
export const semanticAssets = [
  "packages/repositories/semantic-plan-protocol-v1.ts",
  "packages/repositories/semantic-plan-v1.ts",
  "apps/repositories/semantic-plan-v1.ts",
  "tests/semantic-plan-v1.test.ts",
  "evaluation/SEMANTIC_PLAN_V1.md",
  ...semanticSettings.fixtures.flatMap((n) =>
    [
      "manifest.json",
      "original.tar.gz",
      "index.js",
      "native.test.cjs",
      "package.json",
      "public-cases.json",
      "independent-cases.json",
    ].map((p) => "repositories/semantic-plan-v1/" + n + "/" + p),
  ),
  ...literalAssets,
];
export function semanticAssetBytes(path: string) {
  const b = readFileSync(path);
  return path === semanticAssets[0]
    ? Buffer.from(b.toString().replace(SEMANTIC_FREEZE, "__SEMANTIC_FREEZE__"))
    : b;
}
export function auditSemanticPlan(reader = semanticAssetBytes) {
  auditLiteralSerializer();
  const { digest, assets, ...settings } = JSON.parse(
      readFileSync("evaluation/semantic-plan-v1.json", "utf8"),
    ),
    sha = (b: string | Buffer) => createHash("sha256").update(b).digest("hex");
  if (
    digest !== SEMANTIC_FREEZE ||
    JSON.stringify(settings) !== JSON.stringify(semanticSettings) ||
    sha(JSON.stringify({ ...settings, assets })) !== digest ||
    assets.length !== semanticAssets.length ||
    assets.some(
      (a: any, i: number) =>
        a.path !== semanticAssets[i] || a.sha256 !== sha(reader(a.path)),
    )
  )
    throw Error("Semantic integration prospective freeze changed");
  return { digest, assets, ...settings };
}
