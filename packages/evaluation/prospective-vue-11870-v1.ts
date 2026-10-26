import { readFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import { auditProspective } from "./prospective-v1.ts";
import { readPinnedRepositoryArchive } from "../repositories/onboarding-v1.ts";
import { vueWatchUnit } from "./prospective-vue-11589-v1.ts";

export const LIST_FREEZE: string = "bd1068cf07c303df38865af292fd06cc6e5ac1e39fefddc80977c882b32655ca";
export const LIST_TASK = "vuejs__core-11870";
export const LIST_COMMIT = "67d6596d40b1807b9cd8eb0d9282932ea77be3c0";
export const LIST_TREE = "1fdc2d89d23426bcd00db4b3ed24225b98a122cd";
export const LIST_ARCHIVE = "a0cc98ea4ac0db588169a339c4ed4604d6879e0611d1c06851653067b15e9d5b";
const fixtures = "fixtures/prospective-vue-11870-v1/";
const repository = "repositories/prospective-vue-11870-v1/";
const preparation = ".repolab/prospective-vue-11870-v1-preparation/";
const manifestPath = "evaluation/prospective-vue-11870-v1.json";
export const listAssets = [
  "packages/evaluation/prospective-vue-11870-v1.ts",
  "apps/evaluator/prospective-vue-11870-v1.ts",
  "tests/prospective-vue-11870-v1.test.ts",
  "evaluation/PROSPECTIVE_VUE_11870_V1.md",
  repository + "original.tar.gz", repository + "LICENSE",
  repository + "reported.vue", repository + "control-raw.vue", repository + "control-deep.vue",
  repository + "reproduction.cjs",
  fixtures + "original-manifest.json", fixtures + "commit.json", fixtures + "canonical-tree.json",
  fixtures + "context.json", fixtures + "native-plan.json",
  preparation + "execution-blocker.json",
  "packages/evaluation/prospective-v1.ts", "evaluation/prospective-v1.json",
  "packages/repositories/onboarding-v1.ts", "packages/evaluation/prospective-vue-11589-v1.ts",
] as const;
export const listHash = (bytes: string | Uint8Array) => createHash("sha256").update(bytes).digest("hex");
export function listBytes(path: string) {
  const bytes = readFileSync(path);
  return path === listAssets[0] ? Buffer.from(bytes.toString().replace(LIST_FREEZE, "__LIST_FREEZE__")) : bytes;
}
const readJson = (path: string, reader = listBytes) => JSON.parse(reader(path).toString());
export function originalSfc(statement: string) {
  const start = statement.indexOf('<script setup lang="ts">');
  const firstClose = statement.indexOf("</template>", start);
  const end = statement.indexOf("</template>", firstClose + "</template>".length);
  if (start < 0 || firstClose < 0 || end < 0) throw Error("Missing complete original SFC");
  return statement.slice(start, end + "</template>".length).replace(/\r\n/g, "\n") + "\n";
}
export function originalUnitFiles(paths: string[]) {
  return paths.filter(p => /(^|\/)[^/]*\.(test|spec)\.(c|m)?[jt]sx?$/.test(p) &&
    !/(^|\/)(node_modules|dist|cypress|e2e)\//.test(p) && !/(^|\/)\.(idea|git|cache|output|temp)\//.test(p)).sort();
}
export function verifyListSource(reader = listBytes) {
  const manifest = readJson(fixtures + "original-manifest.json", reader);
  const commit = readJson(fixtures + "commit.json", reader), tree = readJson(fixtures + "canonical-tree.json", reader);
  if (manifest.taskId !== LIST_TASK || manifest.repository !== "vuejs/core" || manifest.baseCommit !== LIST_COMMIT ||
      manifest.archiveRoot !== "core-" + LIST_COMMIT || manifest.archiveSha256 !== LIST_ARCHIVE ||
      manifest.archiveBytes !== 1483528 || manifest.files.length !== 697 || manifest.gitTreeSha1 !== LIST_TREE ||
      commit.sha !== LIST_COMMIT || commit.tree.sha !== LIST_TREE || tree.sha !== LIST_TREE || tree.truncated !== false)
    throw Error("Exact original Vue source identity changed");
  const blobs = tree.tree.filter((x: any) => x.type === "blob").sort((a: any,b: any) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  if (tree.tree.some((x: any) => !["blob","tree"].includes(x.type)) || blobs.some((x: any) => x.mode !== "100644") ||
      !isDeepStrictEqual(blobs.map((x: any) => ({path:x.path,bytes:x.size,gitBlobSha1:x.sha,gitMode:x.mode})),
        manifest.files.map(({sha256,...entry}: any) => entry))) throw Error("Original canonical blob inventory changed");
  const files = readPinnedRepositoryArchive(reader(repository + "original.tar.gz"), {
    repository:"vuejs/core",commit:LIST_COMMIT,archiveRoot:manifest.archiveRoot,archiveSha256:LIST_ARCHIVE,files:manifest.files,
  });
  const pkg = JSON.parse(files.get("package.json")!.toString());
  if (pkg.version !== "3.5.3" || pkg.packageManager !== "pnpm@9.10.0" || pkg.type !== "module" ||
      pkg.scripts.build !== "node scripts/build.js" || pkg.scripts["test-unit"] !== "vitest -c vitest.unit.config.ts" ||
      pkg.scripts.preinstall !== "npx only-allow pnpm" || pkg.scripts.postinstall !== "simple-git-hooks" ||
      pkg.devDependencies.vitest !== "^2.0.5" || pkg.devDependencies.jsdom !== "^25.0.0" ||
      files.get(".node-version")!.toString().trim() !== "20" ||
      !files.get("vitest.workspace.ts")!.toString().includes("vitest.unit.config.ts") ||
      !files.get("vitest.unit.config.ts")!.toString().includes("**/e2e/**")) throw Error("Native configuration review changed");
  const context = readJson(fixtures + "context.json", reader), plan = readJson(fixtures + "native-plan.json", reader);
  if (context.instance_id !== LIST_TASK || context.repo !== "vuejs/core" || context.base_commit !== LIST_COMMIT ||
      context.problemSha256 !== "96237613604c182d974dd7437b5ead26d7384ea9a1f2f6248a2ff87c04682662" ||
      listHash(context.problem_statement) !== context.problemSha256 ||
      reader(repository + "reported.vue").toString() !== originalSfc(context.problem_statement)) throw Error("Original issue/SFC binding changed");
  const reported = originalSfc(context.problem_statement);
  const raw = reported.replace("import { shallowReactive, ref, isReactive } from 'vue';", "import { ref, isReactive } from 'vue';\nconst shallowReactive = value => value;");
  const deep = reported.replace("shallowReactive, ref, isReactive", "reactive as shallowReactive, ref, isReactive");
  if (raw === reported || deep === reported || reader(repository + "control-raw.vue").toString() !== raw ||
      reader(repository + "control-deep.vue").toString() !== deep) throw Error("Declared public SFC controls changed");
  const tests = originalUnitFiles(manifest.files.map((f: any) => f.path));
  if (tests.length !== 180 || !isDeepStrictEqual(plan.unitFiles,tests) || plan.taskId !== LIST_TASK || plan.commit !== LIST_COMMIT ||
      plan.packageManager !== pkg.packageManager || plan.unitCommand !== pkg.scripts["test-unit"] || plan.node !== "20.9.0" ||
      plan.workspacePresent !== true || plan.nativeRuntimeQualified !== false || plan.originalReproduced !== false || plan.executionAdmission !== false)
    throw Error("Original native inventory or unqualified status changed");
  return { files:files.size,version:pkg.version,packageManager:pkg.packageManager,archiveBytes:manifest.archiveBytes,
    archiveSha256:LIST_ARCHIVE,gitTreeSha1:LIST_TREE,unitTestFiles:tests.length,unitFilesDigest:listHash(JSON.stringify(tests)),
    lockSha256:manifest.files.find((f:any)=>f.path==="pnpm-lock.yaml").sha256,reportedSfcSha256:listHash(reported) };
}
export function auditListPreparation(reader = listBytes) {
  if (LIST_FREEZE === "__UNFROZEN__") throw Error("Original-only preparation not frozen");
  const p = readJson(manifestPath,reader), {digest,...payload} = p;
  if (digest !== LIST_FREEZE || listHash(JSON.stringify(payload)) !== digest || p.taskId !== LIST_TASK || p.commit !== LIST_COMMIT ||
      p.status !== "PREPARED_ONLY" || p.maxModelCalls !== 0 || p.maxSandboxOperations !== 0 || p.executionAdmission !== false ||
      p.candidateAdmission !== false || p.nativeRuntimeQualified !== false || p.originalReproduced !== false ||
      p.proposedOriginalOperations !== 8 || p.taskOriginalCeiling !== 12 || p.assets.length !== listAssets.length ||
      p.assets.some((a:any,i:number)=>a.path!==listAssets[i] || a.sha256!==listHash(reader(a.path)))) throw Error("Preparation freeze or closed admission changed");
  const parent = auditProspective();
  if (p.prospectiveFreeze !== parent.manifest.digest ||
      parent.tasks.find(t=>t.instance_id===LIST_TASK)?.base_commit !== LIST_COMMIT) throw Error("Fixed prospective task identity changed");
  verifyListSource(reader);
  return p;
}
/** Reads existing guards; it never deletes a lease, dispatches, or asserts resolution from absence. */
export function currentExecutionBlocker() {
  const snapshot = readJson(preparation + "execution-blocker.json");
  const unchanged = snapshot.files.every((f:any)=>existsSync(f.path) && listHash(readFileSync(f.path))===f.sha256);
  return {status:unchanged?"UNCHANGED_UNKNOWN_SUBMISSION":"STATE_CHANGED_REVIEW_REQUIRED",executionAdmission:false,
    bothSharedLeasesPresent:[".repolab/clsx-repair.lock",".repolab/repositories/clsx-repair.lock"].every(p=>existsSync(p))};
}
export function refuseListDispatch(): never {
  throw Error("Offline preparation has no dispatch authority; resolve submission uncertainty and freeze qualified execution separately");
}
export function checkListUnitReport(value: unknown) {
  const manifest=readJson(fixtures+"original-manifest.json");
  return vueWatchUnit(value,originalUnitFiles(manifest.files.map((f:any)=>f.path)));
}
const Dist = z.object({path:z.string().regex(/^packages\/[a-z-]+\/dist\/[A-Za-z0-9_.-]+$/),bytes:z.number().int().positive(),sha256:z.string().regex(/^[a-f0-9]{64}$/)}).strict();
export function checkListObservations(value: unknown, dist: {path:string;bytes:number;sha256:string}[]) {
  const row=z.object({name:z.enum(["reported","raw-control","deep-control"]),sourceSha256:z.string(),
    helper:z.object({listTypes:z.array(z.string()),directTypes:z.array(z.string()),arrayReactive:z.boolean(),arrayShallow:z.boolean()}).strict(),
    text:z.string(),normalizedText:z.string(),warnings:z.array(z.string()).length(0),errors:z.array(z.string()).length(0)}).strict();
  const o=z.object({version:z.literal("3.5.3"),nodeEnv:z.null(),environment:z.literal("jsdom; compiled original SFC; built browser development runtime"),
    loaded:z.array(Dist),observations:z.array(row).length(3)}).strict().parse(value);
  const required=["packages/vue/dist/vue.runtime.global.js","packages/compiler-sfc/dist/compiler-sfc.cjs.js",... ["vue","runtime-dom","runtime-core","reactivity","shared"].map(p=>`packages/${p}/dist/${p}.cjs.js`)];
  if(new Set(o.loaded.map(l=>l.path)).size!==o.loaded.length || required.some(p=>!o.loaded.some(l=>l.path===p)) ||
     o.loaded.some(l=>l.path.endsWith(".prod.js") || !isDeepStrictEqual(dist.find(d=>d.path===l.path),l)))throw Error("Public probe loaded unbound development artifacts");
  const expected=[{name:"reported",file:"reported.vue",types:["string","object"],reactive:true,shallow:true},
    {name:"raw-control",file:"control-raw.vue",types:["object","object"],reactive:false,shallow:false},
    {name:"deep-control",file:"control-deep.vue",types:["string","string"],reactive:true,shallow:false}];
  for(let i=0;i<expected.length;i++){
    const e=expected[i],r=o.observations[i];
    if(r.name!==e.name || r.sourceSha256!==listHash(readFileSync(repository+e.file)) ||
       !isDeepStrictEqual(r.helper.listTypes,[e.types[0]]) || !isDeepStrictEqual(r.helper.directTypes,[e.types[1]]) ||
       r.helper.arrayReactive!==e.reactive || r.helper.arrayShallow!==e.shallow || r.normalizedText!==e.types.join(" ") ||
       r.text.replace(/\s+/g," ").trim()!==r.normalizedText)throw Error("Original shallow-array report or declared control not reproduced");
  }
  return o;
}
