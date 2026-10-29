import {readFileSync,existsSync} from "node:fs";
import {createHash} from "node:crypto";

export const TRANSPORT_FREEZE:string="34d1982a844531ca98401d542676ddb3ab554b33ecfb1b3d0030f157bd47869f";
const prep=".repolab/sandbox-transport-v1-qualification/";
export const transportAssets=[
  "packages/evaluation/sandbox-transport-v1.ts","packages/execution/sandbox-transport-v1.ts","packages/execution/profiled-native-v2.ts",
  "apps/evaluator/sandbox-transport-v1.ts","tests/sandbox-transport-v1.test.ts","evaluation/SANDBOX_TRANSPORT_V1.md",
  prep+"execution-blocker.json",prep+"historical-code.json","packages/execution/profiled-native-v1.ts","packages/execution/nebius.ts",
  "packages/execution/recovery-lease-v1.ts","packages/repositories/repair-lease.ts","packages/storage/reconciliation.ts","evaluation/prospective-v1.json",
] as const;
export const transportHash=(bytes:string|Uint8Array)=>createHash("sha256").update(bytes).digest("hex");
export function transportBytes(path:string){
  const bytes=readFileSync(path);
  return path===transportAssets[0]?Buffer.from(bytes.toString().replace(TRANSPORT_FREEZE,"__TRANSPORT_FREEZE__")):bytes;
}
export function auditSandboxTransportQualification(reader=transportBytes){
  if(TRANSPORT_FREEZE==="__UNFROZEN__")throw Error("Offline transport protocol not frozen");
  const p=JSON.parse(reader("evaluation/sandbox-transport-v1.json").toString()),{digest,...payload}=p;
  if(digest!==TRANSPORT_FREEZE || transportHash(JSON.stringify(payload))!==digest || p.status!=="OFFLINE_PROTOCOL_FROZEN" ||
     p.executionAdmission!==false || p.existingReceiptResolved!==false || p.maxModelCalls!==0 || p.maxSandboxOperations!==0 ||
     p.assets.length!==transportAssets.length || p.assets.some((a:any,i:number)=>a.path!==transportAssets[i] || a.sha256!==transportHash(reader(a.path))))
    throw Error("Offline transport protocol or closed admission changed");
  return p;
}
export function transportExecutionBlocker(){
  const snapshot=JSON.parse(readFileSync(prep+"execution-blocker.json","utf8"));
  const unchanged=snapshot.files.every((f:any)=>existsSync(f.path)&&transportHash(readFileSync(f.path))===f.sha256);
  return {status:unchanged?"UNCHANGED_UNKNOWN_SUBMISSION":"STATE_CHANGED_REVIEW_REQUIRED",executionAdmission:false,
    bothSharedLeasesPresent:[".repolab/clsx-repair.lock",".repolab/repositories/clsx-repair.lock"].every(p=>existsSync(p))};
}
