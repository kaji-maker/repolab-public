import { readFileSync } from "node:fs";
import { isDeepStrictEqual } from "node:util";
import { digest } from "../evaluation/live-release-v1.ts";
import { auditWorkbench as auditParent } from "./preact-workbench-protocol-v1.ts";
export const WORKBENCH_FREEZE = "520dfb352f7e42db88d0f25e6e343cb8655dcf0c690af4926a22712ab7640a7e";
export const workbenchAssets = [
  "packages/repositories/preact-workbench-protocol-v2.ts", "packages/repositories/preact-browser-poll-v1.ts",
  "apps/web/src/FreshPreactV9.tsx", "apps/web/native-repair-v9.html", "apps/api/qualified-server-v2.ts",
  "apps/api/native-server-v10.ts", "vite.native-v10.config.ts", "tests/preact-browser-poll-v1.test.ts", "evaluation/PREACT_BROWSER_POLL_V1.md",
];
export const workbenchSettings = { format: "repolab-preact-workbench/v2", parentWorkbenchFreeze: "6c6e8f0a1561dfe519ce495ba819e3254b24e9f45c0e6c1bda24963dda25280d",
  parentEngineFreeze: "2096c16f472d93957f5e4efc78b55e880d7261ae537d072dcef28748b20bff7a",
  api: "/api/native-preact-repairs-v4", page: "native-repair-v9.html", newLiveQualificationSlots: 0,
  defaultServerAdmission: false, polling: "retain submitted run identity until its terminal row is observed" };
export function workbenchBytes(path: string) {
  const bytes = readFileSync(path);
  return path === workbenchAssets[0] ? Buffer.from(bytes.toString().replace(WORKBENCH_FREEZE, "__WORKBENCH_FREEZE__")) : bytes;
}
export function validateWorkbenchPins(p: any, reader = workbenchBytes) {
  const { freeze, assets, ...settings } = p;
  if (String(WORKBENCH_FREEZE) === "__UNFROZEN__" || freeze !== WORKBENCH_FREEZE || !isDeepStrictEqual(settings, workbenchSettings) ||
    digest(JSON.stringify({ ...settings, assets })) !== freeze || !Array.isArray(assets) || assets.length !== workbenchAssets.length ||
    assets.some((a: any, i: number) => a.path !== workbenchAssets[i] || a.sha256 !== digest(reader(a.path)))) throw Error("Browser polling fix source/settings changed");
  return p;
}
export function auditWorkbench(reader = workbenchBytes) {
  if (auditParent().freeze !== workbenchSettings.parentWorkbenchFreeze) throw Error("Parent workbench changed");
  return validateWorkbenchPins(JSON.parse(readFileSync("evaluation/preact-workbench-v2.json", "utf8")), reader);
}
