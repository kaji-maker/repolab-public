import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import {
  serializerAssets as parentAssets,
  auditSerializerStudy,
} from "./serializer-study-protocol-v2.ts";
export const LITERAL_FREEZE = "2c61c149e27dd4d0a45e90ba371a365c90b6ac481e57cbb56fde9f77ae9013dd";
export const literalSettings = {
  format: "repolab-deterministic-serializer/v1",
  parentFreeze:
    "f7f1313338343dce8f1d677324b69d37e0dfece6ff2e10c6c63eda6f65ad8ac5",
  fixtures: ["escaped-crlf", "duplicate-branches", "large-context"],
  modelCalls: 0,
  maxSandboxOperations: 15,
  nativeRepeats: 2,
  behaviorRepeats: 2,
  allGuestNetworking: false,
  productionPromotion: false,
  scope:
    "deterministic compilation of frozen controller-authored literal intents on exposed formatting fixtures; no model repair or unseen-bug claim",
};
export const literalAssets = [
  "packages/repositories/serializer-literal-protocol-v1.ts",
  "packages/repositories/serializer-literal-v1.ts",
  "packages/repositories/literal-intents-v1.ts",
  "apps/repositories/serializer-literal-v1.ts",
  "tests/literal-intents-v1.test.ts",
  "evaluation/SERIALIZER_LITERAL_V1.md",
  "evaluation/serializer-literal-v1-baselines.json",
  ...literalSettings.fixtures.map(
    (n) => "repositories/serializer-literal-v1/" + n + "/intent.json",
  ),
  ...parentAssets,
];
export function literalAssetBytes(path: string) {
  const b = readFileSync(path);
  return path === literalAssets[0]
    ? Buffer.from(b.toString().replace(LITERAL_FREEZE, "__LITERAL_FREEZE__"))
    : b;
}
export function auditLiteralSerializer(reader = literalAssetBytes) {
  auditSerializerStudy();
  const { digest, assets, ...settings } = JSON.parse(
      readFileSync("evaluation/serializer-literal-v1.json", "utf8"),
    ),
    sha = (b: string | Buffer) => createHash("sha256").update(b).digest("hex");
  if (
    digest !== LITERAL_FREEZE ||
    JSON.stringify(settings) !== JSON.stringify(literalSettings) ||
    sha(JSON.stringify({ ...settings, assets })) !== digest ||
    assets.length !== literalAssets.length ||
    assets.some(
      (a: any, i: number) =>
        a.path !== literalAssets[i] || a.sha256 !== sha(reader(a.path)),
    )
  )
    throw Error("Deterministic serializer freeze changed");
  return { digest, assets, ...settings };
}
