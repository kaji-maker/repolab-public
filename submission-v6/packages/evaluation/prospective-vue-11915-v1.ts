import { readFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import { auditProspective } from "./prospective-v1.ts";
import { readPinnedRepositoryArchive } from "../repositories/onboarding-v1.ts";
import { vueWatchUnit } from "./prospective-vue-11589-v1.ts";

export const TEXTAREA_FREEZE: string = "ee63c08737890ec9aa8e09ca2dd2ff4a1d9c9e010f740e3312e40f9c3872db75";
export const TEXTAREA_TASK = "vuejs__core-11915";
export const TEXTAREA_COMMIT = "d0b513eb463f580e29378e43d112ff6859aa366e";
export const TEXTAREA_TREE = "283c79e64584f42483238782a96f51877113acba";
export const TEXTAREA_ARCHIVE = "4ef45546927b3d915668e2ecfb341c6fcce0a042e666a96dd3f403b9f402c65f";
const fixtures = "fixtures/prospective-vue-11915-v1/";
const repository = "repositories/prospective-vue-11915-v1/";
const preparation = ".repolab/prospective-vue-11915-v1-preparation/";
const manifestPath = "evaluation/prospective-vue-11915-v1.json";
export const textareaAssets = [
  "packages/evaluation/prospective-vue-11915-v1.ts",
  "apps/evaluator/prospective-vue-11915-v1.ts",
  "tests/prospective-vue-11915-v1.test.ts",
  "evaluation/PROSPECTIVE_VUE_11915_V1.md",
  repository + "original.tar.gz", repository + "LICENSE",
  repository + "report-derived.html", repository + "control-plain.html", repository + "control-closed.html", repository + "control-outside.html",
  repository + "reproduction.cjs",
  fixtures + "original-manifest.json", fixtures + "commit.json", fixtures + "canonical-tree.json",
  fixtures + "context.json", fixtures + "native-plan.json", fixtures + "public-fixtures.json",
  preparation + "execution-blocker.json",
  "packages/evaluation/prospective-v1.ts", "evaluation/prospective-v1.json",
  "packages/repositories/onboarding-v1.ts", "packages/evaluation/prospective-vue-11589-v1.ts",
] as const;
export const textareaHash = (bytes: string | Uint8Array) => createHash("sha256").update(bytes).digest("hex");
export function textareaBytes(path: string) {
  const bytes = readFileSync(path);
  return path === textareaAssets[0] ? Buffer.from(bytes.toString().replace(TEXTAREA_FREEZE, "__TEXTAREA_FREEZE__")) : bytes;
}
const readJson = (path: string, reader = textareaBytes) => JSON.parse(reader(path).toString());
export const textareaFixtures = {
  "report-derived.html": '<div v-pre><textarea data-probe>{{</textarea><span data-after>after</span></div>\n',
  "control-plain.html": '<div v-pre><textarea data-probe>literal</textarea><span data-after>after</span></div>\n',
  "control-closed.html": '<div v-pre><textarea data-probe>{{ literal }}</textarea><span data-after>after</span></div>\n',
  "control-outside.html": '<div v-pre><div data-probe>{{</div><span data-after>after</span></div>\n',
};
export const textareaAuthorship = "Authored from frozen issue description; not original jsfiddle bytes";
export function originalUnitFiles(paths: string[]) {
  return paths.filter(p => /(^|\/)[^/]*\.(test|spec)\.(c|m)?[jt]sx?$/.test(p) &&
    !/(^|\/)(node_modules|dist|cypress|e2e)\//.test(p) && !/(^|\/)\.(idea|git|cache|output|temp)\//.test(p)).sort();
}
export function verifyTextareaSource(reader = textareaBytes) {
  const manifest = readJson(fixtures + "original-manifest.json", reader);
  const commit = readJson(fixtures + "commit.json", reader), tree = readJson(fixtures + "canonical-tree.json", reader);
  if (manifest.taskId !== TEXTAREA_TASK || manifest.repository !== "vuejs/core" || manifest.baseCommit !== TEXTAREA_COMMIT ||
      manifest.archiveRoot !== "core-" + TEXTAREA_COMMIT || manifest.archiveSha256 !== TEXTAREA_ARCHIVE ||
      manifest.archiveBytes !== 1485303 || manifest.files.length !== 697 || manifest.gitTreeSha1 !== TEXTAREA_TREE ||
      commit.sha !== TEXTAREA_COMMIT || commit.tree.sha !== TEXTAREA_TREE || tree.sha !== TEXTAREA_TREE || tree.truncated !== false)
    throw Error("Exact original Vue source identity changed");
  const blobs = tree.tree.filter((x: any) => x.type === "blob").sort((a: any,b: any) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  if (tree.tree.some((x: any) => !["blob","tree"].includes(x.type)) || blobs.some((x: any) => x.mode !== "100644") ||
      !isDeepStrictEqual(blobs.map((x: any) => ({path:x.path,bytes:x.size,gitBlobSha1:x.sha,gitMode:x.mode})),
        manifest.files.map(({sha256,...entry}: any) => entry))) throw Error("Original canonical blob inventory changed");
  const files = readPinnedRepositoryArchive(reader(repository + "original.tar.gz"), {
    repository:"vuejs/core",commit:TEXTAREA_COMMIT,archiveRoot:manifest.archiveRoot,archiveSha256:TEXTAREA_ARCHIVE,files:manifest.files,
  });
  const pkg = JSON.parse(files.get("package.json")!.toString());
  if (pkg.version !== "3.5.4" || pkg.packageManager !== "pnpm@9.10.0" || pkg.type !== "module" ||
      pkg.scripts.build !== "node scripts/build.js" || pkg.scripts["test-unit"] !== "vitest -c vitest.unit.config.ts" ||
      pkg.scripts.preinstall !== "npx only-allow pnpm" || pkg.scripts.postinstall !== "simple-git-hooks" ||
      pkg.devDependencies.vitest !== "^2.0.5" || pkg.devDependencies.jsdom !== "^25.0.0" ||
      files.get(".node-version")!.toString().trim() !== "20" ||
      !files.get("vitest.workspace.ts")!.toString().includes("vitest.unit.config.ts") ||
      !files.get("vitest.unit.config.ts")!.toString().includes("**/e2e/**")) throw Error("Native configuration review changed");
  const context = readJson(fixtures + "context.json", reader), plan = readJson(fixtures + "native-plan.json", reader);
  if (context.instance_id !== TEXTAREA_TASK || context.repo !== "vuejs/core" || context.base_commit !== TEXTAREA_COMMIT ||
      context.problemSha256 !== "a378d0fb58a85045c2a2dcba79b56243d64aea479e7ba566cf4fed3577888cb7" ||
      textareaHash(context.problem_statement) !== context.problemSha256) throw Error("Original issue binding changed");
  const publicFixtures = readJson(fixtures + "public-fixtures.json", reader);
  if (publicFixtures.taskId !== TEXTAREA_TASK || publicFixtures.problemSha256 !== context.problemSha256 ||
      publicFixtures.authorship !== textareaAuthorship || publicFixtures.externalReproductionFetched !== false || publicFixtures.independentCasesOpened !== false ||
      !isDeepStrictEqual(publicFixtures.files, Object.entries(textareaFixtures).map(([path, text]) => ({path, sha256: textareaHash(text)}))) ||
      Object.entries(textareaFixtures).some(([path, text]) => reader(repository + path).toString() !== text))
    throw Error("Declared report-derived public fixture bytes/authorship changed");
  const tests = originalUnitFiles(manifest.files.map((f: any) => f.path));
  if (tests.length !== 180 || !isDeepStrictEqual(plan.unitFiles,tests) || plan.taskId !== TEXTAREA_TASK || plan.commit !== TEXTAREA_COMMIT ||
      plan.packageManager !== pkg.packageManager || plan.unitCommand !== pkg.scripts["test-unit"] || plan.node !== "20.9.0" ||
      plan.workspacePresent !== true || plan.browserBuild !== "vue --formats global --prodOnly" ||
      plan.fixtureAuthorship !== textareaAuthorship || plan.browserRuntime !== "full production global build; in-DOM runtime compilation in Chromium" ||
      !isDeepStrictEqual(plan.proposedStages,["prepare","build","protect","integrity","unit-A","reproduction-A","unit-B","reproduction-B"]) ||
      plan.nativeRuntimeQualified !== false || plan.originalReproduced !== false || plan.executionAdmission !== false)
    throw Error("Original native inventory or unqualified status changed");
  return { files:files.size,version:pkg.version,packageManager:pkg.packageManager,archiveBytes:manifest.archiveBytes,
    archiveSha256:TEXTAREA_ARCHIVE,gitTreeSha1:TEXTAREA_TREE,unitTestFiles:tests.length,unitFilesDigest:textareaHash(JSON.stringify(tests)),
    lockSha256:manifest.files.find((f:any)=>f.path==="pnpm-lock.yaml").sha256,fixtureAuthorship:textareaAuthorship, publicFixtureDigests:publicFixtures.files };
}
export function auditTextareaPreparation(reader = textareaBytes) {
  if (TEXTAREA_FREEZE === "__UNFROZEN__") throw Error("Original-only preparation not frozen");
  const p = readJson(manifestPath,reader), {digest,...payload} = p;
  if (digest !== TEXTAREA_FREEZE || textareaHash(JSON.stringify(payload)) !== digest || p.taskId !== TEXTAREA_TASK || p.commit !== TEXTAREA_COMMIT ||
      p.status !== "PREPARED_ONLY" || p.maxModelCalls !== 0 || p.maxSandboxOperations !== 0 || p.executionAdmission !== false ||
      p.candidateAdmission !== false || p.nativeRuntimeQualified !== false || p.originalReproduced !== false ||
      p.proposedOriginalOperations !== 8 || p.taskOriginalCeiling !== 12 || p.assets.length !== textareaAssets.length ||
      p.assets.some((a:any,i:number)=>a.path!==textareaAssets[i] || a.sha256!==textareaHash(reader(a.path)))) throw Error("Preparation freeze or closed admission changed");
  const parent = auditProspective();
  if (p.prospectiveFreeze !== parent.manifest.digest ||
      parent.tasks.find(t=>t.instance_id===TEXTAREA_TASK)?.base_commit !== TEXTAREA_COMMIT) throw Error("Fixed prospective task identity changed");
  verifyTextareaSource(reader);
  return p;
}
/** Reads existing guards; it never deletes a lease, dispatches, or asserts resolution from absence. */
export function currentTextareaBlocker() {
  const snapshot = readJson(preparation + "execution-blocker.json");
  const unchanged = snapshot.files.every((f:any)=>existsSync(f.path) && textareaHash(readFileSync(f.path))===f.sha256);
  return {status:unchanged?"UNCHANGED_UNKNOWN_SUBMISSION":"STATE_CHANGED_REVIEW_REQUIRED",executionAdmission:false,
    bothSharedLeasesPresent:[".repolab/clsx-repair.lock",".repolab/repositories/clsx-repair.lock"].every(p=>existsSync(p))};
}
export function refuseTextareaDispatch(): never {
  throw Error("Offline preparation has no dispatch authority; resolve submission uncertainty and freeze qualified execution separately");
}
export function checkTextareaUnitReport(value: unknown) {
  const manifest=readJson(fixtures+"original-manifest.json");
  return vueWatchUnit(value,originalUnitFiles(manifest.files.map((f:any)=>f.path)));
}
const Dist = z.object({path:z.literal("packages/vue/dist/vue.global.prod.js"),bytes:z.number().int().positive(),sha256:z.string().regex(/^[a-f0-9]{64}$/)}).strict();
const Snapshot = z.object({html:z.string(),text:z.string(),probeTag:z.enum(["TEXTAREA","DIV"]).nullable(),probeText:z.string().nullable(),
  textareaCount:z.number().int().nonnegative(),textareaValue:z.string().nullable(),textareaText:z.string().nullable(),
  afterCount:z.number().int().nonnegative(),afterText:z.string().nullable()}).strict();
export function normalizedTextareaFixture(file: keyof typeof textareaFixtures) {
  return textareaFixtures[file].replace(" v-pre>", ' v-pre="">').replace(" data-probe>", ' data-probe="">').replace(" data-after>", ' data-after="">');
}
/** Proposed gate tested with synthetic data only; never changes preparation/admission status. */
export function checkTextareaObservations(value: unknown, dist: {path:string;bytes:number;sha256:string}[], browserVersion: string) {
  const row=z.object({name:z.enum(["report-derived","plain-control","closed-control","outside-control"]),sourceSha256:z.string(),
    before:Snapshot,after:Snapshot,unmounted:Snapshot,warnings:z.array(z.string()).length(0),errors:z.array(z.string()).length(0)}).strict();
  const o=z.object({version:z.literal("3.5.4"),nodeEnv:z.null(),browserVersion:z.string().min(1),
    fixtureAuthorship:z.literal(textareaAuthorship),externalReproductionFetched:z.literal(false),
    environment:z.literal("Chromium; full production global build; in-DOM runtime compilation"),
    loaded:z.array(Dist).length(1),observations:z.array(row).length(4)}).strict().parse(value);
  if(o.browserVersion!==browserVersion || !/^\d+\.\d+\.\d+\.\d+$/.test(browserVersion) ||
     !isDeepStrictEqual(o.loaded[0],dist.find(d=>d.path===o.loaded[0].path)))throw Error("Unbound production browser/build identity");
  const names=["report-derived","plain-control","closed-control","outside-control"];
  const files=Object.keys(textareaFixtures) as (keyof typeof textareaFixtures)[];
  const literals=["{{","literal","{{ literal }}","{{"];
  const empty={html:"",text:"",probeTag:null,probeText:null,textareaCount:0,textareaValue:null,textareaText:null,afterCount:0,afterText:null};
  for(let i=0;i<files.length;i++){
    const r=o.observations[i],b=r.before,a=r.after,outside=i===3;
    if(r.name!==names[i] || r.sourceSha256!==textareaHash(readFileSync(repository+files[i])) ||
       b.html!==normalizedTextareaFixture(files[i]) || b.probeTag!==(outside?"DIV":"TEXTAREA") || b.probeText!==literals[i] ||
       b.textareaCount!==(outside?0:1) || b.textareaValue!==(outside?null:literals[i]) || b.textareaText!==(outside?null:literals[i]) ||
       b.afterCount!==1 || b.afterText!=="after" || b.text.trim()!==literals[i]+"after")throw Error("Public fixture/source or initial browser DOM changed");
    if(i===0){
      const tail=b.html.slice(b.html.indexOf("{{")).trim();
      if(a.probeTag!=="TEXTAREA" || a.textareaCount!==1 || a.textareaValue?.trim()!==tail || a.textareaText?.trim()!==tail ||
         a.probeText!==a.textareaText || a.text.trim()!==tail || a.afterCount!==0 || a.afterText!==null ||
         !a.html.includes("&lt;/textarea&gt;") || !a.html.includes("&lt;span"))throw Error("Reported escaped textarea tail was not observed");
    }else if(a.probeTag!==(outside?"DIV":"TEXTAREA") || a.probeText!==literals[i] || a.textareaCount!==(outside?0:1) ||
      a.textareaValue!==(outside?null:literals[i]) || a.textareaText!==(outside?null:literals[i]) ||
      a.afterCount!==1 || a.afterText!=="after" || a.text.trim()!==literals[i]+"after" || a.html.includes("&lt;/textarea&gt;"))
      throw Error("Declared textarea/literal public control failed");
    if(!isDeepStrictEqual(r.unmounted,empty))throw Error("Public DOM did not unmount cleanly");
  }
  return o;
}
