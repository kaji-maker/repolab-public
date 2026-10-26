import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import {
  semanticAssets as parentAssets,
  auditSemanticPlan as auditParent,
} from "./semantic-plan-protocol-v1.ts";
export const SEMANTIC_FREEZE = "315812db5047a4e8af247fdcfd23c8feeff1288fa5abe9dc4382fcd3d40a46e4";
export const semanticSettings = {
  format: "repolab-semantic-plan-integration/v2",
  parentFreeze:
    "9d1838058080bad645aa65856ec86952721d9df5c62a66a6ffc2ad29378215e6",
  fixtures: ["nullish-default", "option-default"],
  model: "nvidia/nemotron-3-super-120b-a12b",
  requestPolicy:
    "full-thinking; schema in system and response_format; readable original source plus static TypeScript 6.0.3 token/expression anchors",
  outputTokens: 16384,
  requestBytes: 64000,
  ratesUsdPerMillion: { input: 0.3, output: 0.9 },
  maxCandidates: 2,
  maxModelCalls: 4,
  maxSandboxOperations: 40,
  qualificationOperationsPerFixture: 8,
  repairOperationsPerFixture: 12,
  publicRepeats: 2,
  nativeRepeats: 2,
  independentRepeats: 2,
  allGuestNetworking: false,
  monetaryCap: null,
  automaticProviderRetry: false,
  productionPromotion: false,
  scope:
    "two previously exposed controller-authored semantic development fixtures; count-window closed after independent evaluation; independent cases withheld from model until after source selection; no fresh GitHub or unseen-bug score claim",
};
export const semanticAssets = [
  "packages/repositories/semantic-plan-protocol-v2.ts",
  "packages/repositories/semantic-plan-v2.ts",
  "packages/repositories/source-anchors-v1.ts",
  "packages/repositories/source-syntax-v1.ts",
  "repositories/semantic-plan-v2/driver.cjs",
  "apps/repositories/semantic-plan-v2.ts",
  "tests/semantic-plan-v2.test.ts",
  "evaluation/SEMANTIC_PLAN_V2.md",
  "package.json",
  "package-lock.json",
  ...parentAssets,
];
export function semanticAssetBytes(path: string) {
  const b = readFileSync(path);
  return path === semanticAssets[0]
    ? Buffer.from(b.toString().replace(SEMANTIC_FREEZE, "__SEMANTIC_FREEZE__"))
    : b;
}
export function auditSemanticPlan(reader = semanticAssetBytes) {
  auditParent();
  const { digest, assets, ...settings } = JSON.parse(
      readFileSync("evaluation/semantic-plan-v2.json", "utf8"),
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
