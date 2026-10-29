import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
export const SERIALIZER_STUDY_FREEZE = "eeb9beda88c0b95fb58dec3037d1210c87b66388c6e3ca173c6e0aa31d6b812b";
export const serializerSettings = {
  format: "repolab-serializer-study/v1",
  parentFreeze:
    "0dcf53e9f6064a2b7828a6767b3bbde1d00ecf85722142983c63b76b6231028e",
  fixtures: ["escaped-crlf", "duplicate-branches", "large-context"],
  modes: ["full-thinking", "direct-json"],
  repetitions: ["A", "B"],
  model: "nvidia/nemotron-3-super-120b-a12b",
  outputTokens: 16384,
  requestBytes: 64000,
  ratesUsdPerMillion: { input: 0.3, output: 0.9 },
  monetaryCap: null,
  maxModelCalls: 12,
  maxSandboxOperations: 75,
  originalOperationsPerFixture: 5,
  candidateOperationsPerSlot: 5,
  allGuestNetworking: false,
  automaticRetry: false,
  schemaInSystemAndResponseFormat: true,
  qualification:
    "6/6 exact serializations plus native and behavioral checks twice per mode; failed/blocked slots retained",
  productionPromotion: false,
  scope:
    "controller-authored serialization fixtures only; no GitHub repair or unseen-bug success claim; current full-thinking repair path unchanged",
};
export const serializerAssets = [
  "packages/repositories/serializer-study-protocol-v1.ts",
  "packages/repositories/serializer-study-v1.ts",
  "packages/providers/nebius-format-v1.ts",
  "packages/repositories/source-edits-v3.ts",
  "packages/repositories/source-edits-v2.ts",
  "packages/repositories/cross-runtime-v2.ts",
  "packages/execution/cross-repo-sandbox-v1.ts",
  "packages/execution/fresh-native-signature-v1.ts",
  "repositories/fresh-pilot-v3/driver.cjs",
  "repositories/cross-repo-v1/child.cjs",
  "apps/repositories/serializer-study-v1.ts",
  "tests/serializer-study-v1.test.ts",
  "evaluation/SERIALIZER_STUDY_V1.md",
  ...serializerSettings.fixtures.flatMap((name) =>
    [
      "manifest.json",
      "original.tar.gz",
      "package.json",
      "native.test.cjs",
      "index.js",
      ...(name === "large-context" ? ["prefix.js"] : []),
    ].map((path) => "repositories/serializer-study-v1/" + name + "/" + path),
  ),
];
export function serializerAssetBytes(path: string) {
  const bytes = readFileSync(path);
  return path === serializerAssets[0]
    ? Buffer.from(
        bytes
          .toString()
          .replace(SERIALIZER_STUDY_FREEZE, "__SERIALIZER_STUDY_FREEZE__"),
      )
    : bytes;
}
export function auditSerializerStudy(reader = serializerAssetBytes) {
  const { digest, assets, ...settings } = JSON.parse(
    readFileSync("evaluation/serializer-study-v1.json", "utf8"),
  );
  const sha = (b: string | Buffer) =>
    createHash("sha256").update(b).digest("hex");
  if (
    digest !== SERIALIZER_STUDY_FREEZE ||
    JSON.stringify(settings) !== JSON.stringify(serializerSettings) ||
    sha(JSON.stringify({ ...settings, assets })) !== digest ||
    assets.length !== serializerAssets.length ||
    assets.some(
      (a: any, i: number) =>
        a.path !== serializerAssets[i] || a.sha256 !== sha(reader(a.path)),
    )
  )
    throw Error("Serializer study prospective freeze changed");
  return { digest, assets, ...settings };
}
