import { existsSync, readFileSync } from "node:fs";
import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import type { OriginalNativeProfile } from "../execution/profiled-native-v1.ts";
import {
  auditFocus as auditV1, verifyFocusSource, focusHash, focusRequest as requestV1,
  parseFocusReceipt, focusUploads as uploadsV1, focusSlots as slotsV1,
  FOCUS_IMAGE as initialImage, FOCUS_TASK, FOCUS_COMMIT, FOCUS_FREEZE as freezeV1,
} from "./prospective-preact-3763-v1.ts";
export { verifyFocusSource, focusHash, parseFocusReceipt, focusSuite, focusCommands } from "./prospective-preact-3763-v1.ts";
export { FOCUS_TASK, FOCUS_COMMIT };

export const FOCUS_FREEZE: string = "c57cd84a70c591520fbd220cdbba5119592eca45c1ef89cf9169d6ccf07694ce";
export const FOCUS_IMAGE = "593480da-88a9-4b33-9b1f-2a47b2f22431";
export const focusSlots = ["lint", "mocha-A", "browser-A", "reproduction-A", "mocha-B", "browser-B", "reproduction-B"] as const;
export const focusSaved: string[] = [];
export const focusUploads: [string, string][] = [];
const previous = ".repolab/prospective-preact-3763-v1/run/";
const recovery = previous + "recovery-fc0f8de9-fa4e-424b-b515-cf603e56ec6f-6af88c73-e4d6-43ac-9b89-42cec3c201b0.json";
const read = (path: string) => JSON.parse(readFileSync(path, "utf8"));
export const focusAssets = [
  "packages/evaluation/prospective-preact-3763-v2.ts",
  "apps/evaluator/prospective-preact-3763-v2.ts",
  "tests/prospective-preact-3763-v2.test.ts",
  "evaluation/PROSPECTIVE_PREACT_3763_V2.md",
  "evaluation/prospective-preact-3763-v1.json",
  "packages/evaluation/prospective-preact-3763-v1.ts",
  "packages/execution/profiled-native-v1.ts",
  ...["prepare", "build", "protect", "integrity", "lint"].map(slot => previous + slot + ".json"),
  ...uploadsV1.map(([, name]) => previous + "upload-" + name + ".json"),
  recovery,
  "evaluation/prospective-preact-3763-v1-results-summary.json",
];
export function focusBytes(path: string) {
  const bytes = readFileSync(path);
  return path === focusAssets[0] ? Buffer.from(bytes.toString().replace(FOCUS_FREEZE, "__FOCUS_FREEZE__")) : bytes;
}
/** Saved-data audit only: V1's unverified record is never rewritten or promoted. */
export function auditPreviousAttempt() {
  auditV1();
  let image = initialImage;
  const ids = new Set<string>();
  let umd: {sha256:string;bytes:number} | undefined;
  let lint: any;
  for (const slot of ["prepare", "build", "protect", "integrity", "lint"]) {
    const r = read(previous + slot + ".json");
    if (r.slot !== slot || r.execution !== "nebius-sandbox; reviewed original" || r.inference !== "none" ||
        ids.has(r.id) || !isDeepStrictEqual(r.request, requestV1(slot, image, slot === "prepare" ? r.request.files : {})) ||
        r.owner.requestSha256 !== focusHash(JSON.stringify(r.request))) throw Error("Previous original request binding changed");
    z.uuid().parse(r.id); ids.add(r.id);
    if (slot === "prepare") {
      const files: Record<string,unknown> = {};
      for (const [source,name] of uploadsV1) {
        const u=read(previous+"upload-"+name+".json");
        if(u.status!=="VERIFIED" || u.source!==source || u.sha256!==focusHash(readFileSync(source)) ||
           u.response.sha256!==u.sha256 || ![-1,readFileSync(source).length].includes(u.response.size)) throw Error("Previous upload changed");
        files["/opt/repolab/prospective-native/"+name]={uuid:z.uuid().parse(u.response.uuid),uid:0,gid:0,mode:"0444"};
      }
      if(!isDeepStrictEqual(r.request.files,files))throw Error("Previous closed uploads changed");
    }
    if (slot === "lint") {
      if(r.state!=="UNKNOWN" || r.receiptValidated===true || r.latest?.uuid!==r.id ||
         r.latest?.image_uuid!==image || r.latest?.status!=="EXECUTING") throw Error("Retained V1 uncertainty changed");
      lint=r;
    } else {
      if(r.state!=="TERMINAL" || r.receiptValidated!==true)throw Error("Previous native setup not qualified");
      const parsed=parseFocusReceipt(r.latest,slot,r.id,image);
      if(slot==="build")umd=parsed.guest.umd;
      if(slot==="protect" || slot==="integrity")if(!isDeepStrictEqual(parsed.guest.umd,umd))throw Error("Protected original UMD changed");
      if(["prepare","build","protect"].includes(slot))image=parsed.op.result_image_uuid!;
    }
  }
  if(image!==FOCUS_IMAGE || ids.size!==5 || ids.size+focusSlots.length!==12 ||
     slotsV1.filter(s=>!["prepare","build","protect","integrity","lint"].includes(s)).some(s=>existsSync(previous+s+".json")))
    throw Error("Original task ceiling or protected image changed");
  const recovered=read(recovery);
  if(recovered.state!=="TERMINAL" || recovered.verified!==false ||
     !isDeepStrictEqual(recovered.owner,lint.owner) || recovered.originalHash!==focusHash(readFileSync(previous+"lint.json")) ||
     recovered.raw.uuid!==lint.id || recovered.raw.image_uuid!==image)throw Error("Read-only resolution binding changed");
  // Confirms the retained operation is terminal and successful, without accepting V1 or resuming it.
  parseFocusReceipt(recovered.raw,"lint",lint.id,image);
  return {operations:5,ids:[...ids],status:"STOPPED_UNQUALIFIED",lintReadOnlyResolved:true,priorFreeze:freezeV1,protectedImage:image,umd:umd!};
}
export function auditFocus(reader=focusBytes) {
  if(FOCUS_FREEZE==="__UNFROZEN__")throw Error("New original qualification is not frozen");
  const p=read("evaluation/prospective-preact-3763-v2.json"), {digest,...payload}=p;
  if(digest!==FOCUS_FREEZE || focusHash(JSON.stringify(payload))!==digest || p.taskId!==FOCUS_TASK ||
     p.commit!==FOCUS_COMMIT || p.image!==FOCUS_IMAGE || p.inferenceCalls!==0 || p.modelAdmission!==false ||
     p.maxOperations!==7 || p.priorOperations!==5 || p.taskOriginalCeiling!==12 || p.previousFreeze!==freezeV1 ||
     !isDeepStrictEqual(p.slots,focusSlots) || p.assets.length!==focusAssets.length ||
     p.assets.some((a:any,i:number)=>a.path!==focusAssets[i] || a.sha256!==focusHash(reader(a.path))))throw Error("V2 original qualification freeze changed");
  auditPreviousAttempt();
  return p;
}
export function focusRequest(slot:string,image:string,files:Record<string,unknown>={}) {
  z.enum(focusSlots).parse(slot);
  if(image!==FOCUS_IMAGE || Object.keys(files).length)throw Error("Exact protected original image and no new inputs required");
  return requestV1(slot,image,files);
}
export const focusProfile:OriginalNativeProfile={
  id:"prospective-preact-3763-v2",image:FOCUS_IMAGE,inputDirectory:"/opt/repolab/prospective-native",
  slots:focusSlots,savedSlots:focusSaved,uploads:focusUploads,audit:auditFocus,request:focusRequest,parse:parseFocusReceipt,
};
