import { readFileSync } from "node:fs";
import { isDeepStrictEqual } from "node:util";
import { digest } from "../evaluation/live-release-v1.ts";
import { auditFreshPreact } from "./preact-repair-protocol-v4.ts";
export const WORKBENCH_FREEZE = "6c6e8f0a1561dfe519ce495ba819e3254b24e9f45c0e6c1bda24963dda25280d";
export const workbenchAssets = [
  "packages/repositories/preact-workbench-protocol-v1.ts",
  "packages/repositories/preact-repair-history-v4.ts",
  "apps/api/preact-repair-v4.ts", "apps/api/qualified-server-v1.ts", "apps/api/native-server-v9.ts",
  "apps/web/src/FreshPreactV8.tsx", "apps/web/src/fresh-preact-v8.css", "apps/web/src/fresh-preact.css",
  "apps/web/native-repair-v8.html", "vite.native-v9.config.ts",
  "tests/preact-workbench-v1.test.ts", "evaluation/PREACT_WORKBENCH_V1.md",
];
export const workbenchSettings = {
  format: "repolab-preact-workbench/v1", parentEngineFreeze: "2096c16f472d93957f5e4efc78b55e880d7261ae537d072dcef28748b20bff7a",
  api: "/api/native-preact-repairs-v4", page: "native-repair-v8.html", server: "apps/api/native-server-v9.ts",
  newLiveQualificationSlots: 0, defaultServerAdmission: false, legacyDispatch: false,
  automaticRecovery: false, cachedReview: "all raw bytes and bound source/prior artifacts unchanged",
};
export function workbenchBytes(path: string) {
  const bytes = readFileSync(path);
  return path === workbenchAssets[0] ? Buffer.from(bytes.toString().replace(WORKBENCH_FREEZE, "__WORKBENCH_FREEZE__")) : bytes;
}
export function validateWorkbenchPins(p: any, reader = workbenchBytes) {
  const { freeze, assets, ...settings } = p;
  if (String(WORKBENCH_FREEZE) === "__UNFROZEN__" || freeze !== WORKBENCH_FREEZE || !isDeepStrictEqual(settings, workbenchSettings) ||
    digest(JSON.stringify({ ...settings, assets })) !== freeze || !Array.isArray(assets) || assets.length !== workbenchAssets.length ||
    assets.some((a: any, i: number) => a.path !== workbenchAssets[i] || a.sha256 !== digest(reader(a.path))))
    throw Error("Qualified workbench source/settings changed");
  return p;
}
export function auditWorkbench(reader = workbenchBytes) {
  const parent = auditFreshPreact();
  if (parent.digest !== workbenchSettings.parentEngineFreeze) throw Error("Qualified V4 engine changed");
  return validateWorkbenchPins(JSON.parse(readFileSync("evaluation/preact-workbench-v1.json", "utf8")), reader);
}
