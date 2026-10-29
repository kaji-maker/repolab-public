import { readFileSync } from "node:fs";
import { shaNative } from "../evaluation/preact-native-v5.ts";
import { auditFreshPreact as auditParent, freshSettings as parentSettings } from "./preact-repair-protocol-v3.ts";
export const REPAIR_FREEZE = "2096c16f472d93957f5e4efc78b55e880d7261ae537d072dcef28748b20bff7a";
export const freshAssets = [
  "packages/repositories/preact-repair-protocol-v4.ts",
  "packages/execution/preact-terminal-time-v1.ts",
  "packages/execution/guarded-preact-sandbox-v2.ts",
  "packages/repositories/preact-repair-v4.ts",
  "tests/preact-terminal-time-v1.test.ts",
  "evaluation/PREACT_TERMINAL_TIME_V1.md",
];
export const freshSettings = {
  ...parentSettings,
  format: "repolab-native-preact-repair-protocol/v4",
  parentRepairFreeze: "e50e387594890fcbcff387c1e1e95d90ea857b320105c8c765ecbd226a384449",
  terminalObservation: "Record canonical completion time for exact owned terminal observations even when guest validation rejects",
  newLiveQualificationSlots: 0,
};
export function freshBytes(path: string) {
  const bytes = readFileSync(path);
  return path === freshAssets[0] ? Buffer.from(bytes.toString().replace(REPAIR_FREEZE, "__REPAIR_FREEZE__")) : bytes;
}
export function auditFreshPreact(reader = freshBytes) {
  const parent = auditParent();
  if (String(REPAIR_FREEZE) === "__UNFROZEN__") throw Error("Terminal timestamp fix is not frozen");
  const p = JSON.parse(readFileSync("evaluation/preact-product-repair-v4.json", "utf8"));
  const { digest, assets, contextHash, systemHash, ...settings } = p;
  if (digest !== REPAIR_FREEZE || JSON.stringify(settings) !== JSON.stringify(freshSettings) ||
      contextHash !== parent.contextHash || systemHash !== parent.systemHash ||
      shaNative(JSON.stringify({ ...settings, contextHash, systemHash, assets })) !== digest ||
      assets.length !== freshAssets.length || assets.some((a: any, i: number) => a.path !== freshAssets[i] || a.sha256 !== shaNative(reader(a.path))))
    throw Error("Terminal timestamp fix source/settings changed");
  return p;
}
