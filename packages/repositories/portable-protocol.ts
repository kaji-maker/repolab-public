import { readFileSync } from "node:fs";
import { sha256 } from "../evidence/hash.ts";
import { auditCommonStudy as audit9 } from "../evaluation/study-protocol-v9.ts";

export const frozenPortableDigest = "bd5ef5501d173ec06e44f91675fd4ae127be33040e58823b4cab04570053732c";
export const portableAssets = [
  "packages/repositories/portable-protocol.ts",
  "packages/repositories/portable-pack.ts",
  "packages/repositories/portable-replay.ts",
  "packages/evaluation/protocol.ts",
  "apps/api/app.ts",
  "apps/api/server.ts",
  "apps/repositories/portable.ts",
  "apps/web/src/main.tsx",
  "apps/web/src/PortablePacks.tsx",
  "tests/portable-pack.test.ts",
  "tests/evaluation-protocol.test.ts",
  "scripts/portable-browser-smoke.mjs",
  "evaluation/PORTABLE_PACKS_V1.md",
  "evaluation/study-v5-results-summary.json",
  "evaluation/study-v8-results-summary.json",
  "evaluation/study-v9-results-summary.json",
  "evaluation/archive/v9/apps/api/app.ts.txt",
  "evaluation/archive/v9/apps/api/server.ts.txt",
  "evaluation/archive/v9/apps/web/src/main.tsx.txt",
] as const;
export function portableAssetBytes(path: string) {
  const s = readFileSync(path, "utf8");
  return path === portableAssets[0]
    ? s.replace(
        /export const frozenPortableDigest\s*=\s*"[a-f0-9]{64}";/,
        'export const frozenPortableDigest="' + "0".repeat(64) + '";',
      )
    : s;
}
export function auditPortableProtocol() {
  const p = JSON.parse(
      readFileSync("evaluation/portable-packs-v1.json", "utf8"),
    ),
    { digest, ...payload } = p;
  if (
    digest !== frozenPortableDigest ||
    sha256(JSON.stringify(payload)) !== digest ||
    p.format !== "repolab-portable-packs/v1" ||
    p.previousStudyDigest !== audit9().digest ||
    p.inferenceCalls !== 0 ||
    p.maxOperations !== 16 ||
    JSON.stringify(p.profiles) !==
      JSON.stringify([
        "dlv-null-path",
        "dset-decimal-path",
        "mri-zero-number",
      ]) ||
    p.assets.length !== portableAssets.length ||
    p.assets.some(
      (a: any, i: number) =>
        a.path !== portableAssets[i] ||
        sha256(portableAssetBytes(a.path)) !== a.sha256,
    )
  )
    throw Error("Portable pack freeze changed");
  return p;
}
