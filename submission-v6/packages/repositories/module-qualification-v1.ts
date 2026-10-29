import { readFileSync, existsSync } from "node:fs";
import { mkdir, readdir } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import {
  CrossRepoSandbox,
  crossRequest,
  crossSha,
  parseCrossReceipt,
} from "../execution/cross-repo-sandbox-v1.ts";
import { sandboxConfigFromEnv } from "../execution/nebius.ts";
import { acquireRepairLease } from "./repair-lease.ts";
import { saveCross, crossSourceHash } from "./fresh-pilot-v4.ts";
import {
  githubAnchorTask,
  parseGithubRuntimeReceipt,
} from "./github-anchor-v2.ts";
import { githubControls, compileGithubAnchors } from "./github-anchor-v1.ts";
import {
  githubRepairConfig,
  assertGithubIsolation,
  loadGithubQualification,
} from "./github-anchor-v3.ts";
import { auditGithubRepairProtocol } from "./github-anchor-protocol-v3.ts";
import {
  ModuleAdmissionError,
  moduleEntries,
  moduleLoadCases,
  moduleLoadBaseline,
  assertModuleLoad,
} from "./module-admission-v1.ts";

export const MODULE_QUALIFICATION_FREEZE = "c91ab1f49096ce6fa753fde0b3b60a932616e952ab7a0d7e323294313fbc645c";
export const MODULE_QUALIFICATION_ROOT = ".repolab/module-qualification-v1";
const V3 = ".repolab/github-anchor-v3/regexparam/";
const V1_CONTROL = '\nconst broken = true ? "incomplete";\n';

/** Zero-inference Sandbox qualification of the V4 checker and load gates on regexparam. */
export const moduleQualificationSettings = {
  format: "repolab-module-load-qualification/v1",
  task: "regexparam",
  inference: "none",
  maxModelCalls: 0,
  operations: [
    "qual-syntax",
    "qual-load-original",
    "qual-load-c1",
    "qual-load-c2",
  ],
  loadRuntime: "v24.18.0",
  bindings: {
    v2QualificationResultSha256:
      "67c86d30ee0dd39de50de54375f4512e9ebcf9cfa9534260a8d7ad28a618d811",
    v3RepairResultSha256:
      "91fad23a33ef08bb232426ebdfc5828af78b929c38d914782b9bda70a9da283b",
    originalImage: "127db35f-afb9-498a-a36e-bf1ed939470e",
    candidates: [
      {
        attempt: 1,
        image: "af025f03-f2a6-4987-968c-127143111994",
        candidateFileSha256:
          "f1021d683a721d9aa88ff09b0a67a04547fb3b4a57e66351ce88582c9fccec48",
        sourceHash:
          "e3bccbbfa1b99bd00cccf74ad9a4b542e5e84a8e4d47c8cfdeb2148ea3aa599f",
      },
      {
        attempt: 2,
        image: "3a559e9b-0aab-49dc-b2b7-43a79be2cee4",
        candidateFileSha256:
          "c254d784eb2dfdbd9cc318acef7216a0df2553806cb21025ebaf534bc1f50039",
        sourceHash:
          "fd89716b6eac8ee982c817d830a84b9b045ca60db30d6154312d00f5127a5939",
      },
    ],
  },
  expectedShape: { type: "object", keys: ["inject", "parse"] },
  // `accepted` = exit 0 with empty output; `rejected` requires the stderr marker.
  syntaxControls: [
    { id: "js-original", file: "src/index.js", base: "original", tail: "", expected: "accepted" },
    { id: "js-v1-control", file: "src/index.js", base: "original", tail: V1_CONTROL, expected: "accepted" },
    { id: "js-export-invalid", file: "src/index.js", base: "original", tail: "\nexport const x = ;\n", expected: "accepted" },
    { id: "js-candidate-1", file: "src/index.js", base: "candidate-1", tail: "", expected: "accepted" },
    { id: "js-candidate-2", file: "src/index.js", base: "candidate-2", tail: "", expected: "accepted" },
    { id: "cjs-valid", file: "src/index.js", base: "empty", tail: '"use strict";\nmodule.exports = 1;\n', expected: "accepted" },
    { id: "cjs-v1-control", file: "src/index.js", base: "empty", tail: '"use strict";' + V1_CONTROL, expected: "rejected:SyntaxError" },
    { id: "mjs-original", file: "src/index.mjs", base: "original", tail: "", expected: "accepted" },
    { id: "mjs-v1-control", file: "src/index.mjs", base: "original", tail: V1_CONTROL, expected: "rejected:SyntaxError" },
    { id: "mjs-candidate-1", file: "src/index.mjs", base: "candidate-1", tail: "", expected: "rejected:Invalid regular expression" },
    { id: "mjs-candidate-2", file: "src/index.mjs", base: "candidate-2", tail: "", expected: "rejected:Invalid regular expression" },
  ],
  scope:
    "Zero-inference qualification of the Sandbox syntax checker and module-load gate using the qualified regexparam original image and the two rejected V3 candidate images. Establishes gate behavior only; it is not a repair attempt and does not open independent cases.",
};
export const moduleQualificationAssets = [
  "packages/repositories/module-qualification-v1.ts",
  "packages/repositories/module-admission-v1.ts",
  "repositories/module-admission-v1/qualify.cjs",
  "repositories/github-anchor-v2/driver.cjs",
  "repositories/cross-repo-v1/child.cjs",
  "apps/repositories/module-qualification-v1.ts",
  "tests/module-qualification-v1.test.ts",
  "tests/module-admission-v1.test.ts",
  "evaluation/github-anchor-v3.json",
];
export function moduleQualificationAssetBytes(path: string) {
  const b = readFileSync(path);
  return path === moduleQualificationAssets[0]
    ? Buffer.from(
        b
          .toString()
          .replace(MODULE_QUALIFICATION_FREEZE, "__MODULE_QUALIFICATION_FREEZE__"),
      )
    : b;
}
export function moduleQualificationFreezeRecord(
  reader = moduleQualificationAssetBytes,
) {
  const assets = moduleQualificationAssets.map((path) => ({
      path,
      sha256: crossSha(reader(path)),
    })),
    digest = crossSha(
      JSON.stringify({ ...moduleQualificationSettings, assets }),
    );
  return { digest, ...moduleQualificationSettings, assets };
}
export function auditModuleQualification(
  reader = moduleQualificationAssetBytes,
  freeze = MODULE_QUALIFICATION_FREEZE,
) {
  auditGithubRepairProtocol();
  if (!/^[a-f0-9]{64}$/.test(freeze))
    throw Error("Module qualification protocol is not frozen");
  const { digest, assets, ...settings } = JSON.parse(
    readFileSync("evaluation/module-qualification-v1.json", "utf8"),
  );
  if (
    digest !== freeze ||
    JSON.stringify(settings) !== JSON.stringify(moduleQualificationSettings) ||
    crossSha(JSON.stringify({ ...settings, assets })) !== digest ||
    assets.length !== moduleQualificationAssets.length ||
    assets.some(
      (a: any, i: number) =>
        a.path !== moduleQualificationAssets[i] ||
        a.sha256 !== crossSha(reader(a.path)),
    )
  )
    throw Error("Module qualification freeze changed");
}

/** Re-binds V2 qualification and V3 candidate evidence; recompiles each saved plan. */
export function qualificationInputs(reader = (p: string) => readFileSync(p)) {
  const s = moduleQualificationSettings.bindings,
    m = githubAnchorTask(moduleQualificationSettings.task),
    q = loadGithubQualification(moduleQualificationSettings.task);
  if (
    crossSha(reader(".repolab/github-anchor-v1/regexparam/result.json")) !==
      s.v2QualificationResultSha256 ||
    q.originalImage !== s.originalImage
  )
    throw Error("Original qualification binding changed");
  const v3Bytes = reader(V3 + "result.json");
  if (crossSha(v3Bytes) !== s.v3RepairResultSha256)
    throw Error("V3 repair evidence changed");
  const v3 = JSON.parse(v3Bytes.toString());
  const candidates = s.candidates.map((b) => {
    const bytes = reader(V3 + "candidate-" + b.attempt + ".json"),
      saved = JSON.parse(bytes.toString()),
      prior = v3.candidates.find((c: any) => c.attempt === b.attempt),
      compiled = compileGithubAnchors(m, saved.plan);
    if (
      crossSha(bytes) !== b.candidateFileSha256 ||
      prior?.status !== "REJECTED" ||
      prior.image !== b.image ||
      prior.sourceHash !== b.sourceHash ||
      compiled.sourceHash !== b.sourceHash ||
      crossSourceHash(m, saved.files) !== b.sourceHash ||
      !isDeepStrictEqual(compiled.files, saved.files)
    )
      throw Error("V3 candidate binding changed: " + b.attempt);
    return {
      attempt: b.attempt,
      image: b.image,
      sources: compiled.files as Record<string, string>,
      generatedHashes: prior.generatedHashes as Record<string, string>,
    };
  });
  return { m, q, candidates };
}

export function syntaxControlContents(
  m: any,
  candidates: { attempt: number; sources: Record<string, string> }[],
) {
  const base = (b: string) =>
    b === "empty"
      ? ""
      : b === "original"
        ? m.sources["src/index.js"]
        : candidates.find((c) => "candidate-" + c.attempt === b)!.sources[
            "src/index.js"
          ];
  return moduleQualificationSettings.syntaxControls.map((s) => ({
    id: s.id,
    file: s.file,
    content: base(s.base) + s.tail,
  }));
}

export function qualificationRequest(
  image: string,
  files: Record<string, unknown>,
) {
  return {
    ...crossRequest(image, files, "observations"),
    args: ["/opt/repolab/cross/qualify.cjs"],
    networking: { enabled: false },
    timeout: 120,
    disposable: true,
  };
}

const outcome = (r: any) =>
  r.exitCode === 0 &&
  r.signal === null &&
  r.error === null &&
  r.stdout === "" &&
  r.stderr === ""
    ? "accepted"
    : r.exitCode !== 0 && r.signal === null && r.error === null
      ? "rejected"
      : "unknown";

export function assessSyntax(
  guest: any,
  config: any,
  expected = moduleQualificationSettings.syntaxControls,
) {
  if (!isDeepStrictEqual(guest?.files, config.expectedFiles))
    throw Error("Syntax qualification image identity changed");
  if (
    guest.checkerVersion?.exitCode !== 0 ||
    guest.checkerVersion.stdout.trim() !== moduleQualificationSettings.loadRuntime
  )
    throw Error("Sandbox checker runtime differs");
  if (
    !Array.isArray(guest.controls) ||
    guest.controls.length !== expected.length
  )
    throw Error("Incomplete syntax control inventory");
  return expected.map((e, i) => {
    const row = guest.controls[i],
      sent = config.controls[i],
      path = "/tmp/repolab-qualify/" + e.id + "/" + e.file;
    if (
      row.id !== e.id ||
      sent.id !== e.id ||
      row.file !== e.file ||
      row.sha256 !== crossSha(sent.content) ||
      row.packageSha256 !== config.expectedFiles["package.json"] ||
      row.command !== "/usr/local/bin/node" ||
      !isDeepStrictEqual(row.args, ["--check", path]) ||
      row.uid !== 1000
    )
      throw Error("Syntax control identity changed: " + e.id);
    const observed = outcome(row.check),
      [kind, marker] = e.expected.split(":");
    if (
      observed !== kind ||
      (marker && !String(row.check.stderr).includes(marker))
    )
      throw Error(
        "Syntax control " + e.id + " expected " + e.expected + ", observed " + observed,
      );
    return {
      id: e.id,
      file: e.file,
      sha256: row.sha256,
      observed,
      exitCode: row.check.exitCode,
      stderrLine:
        String(row.check.stderr)
          .split("\n")
          .find((l) => /Error/.test(l)) ?? null,
    };
  });
}

const LOAD_ERROR = /^Invalid regular expression: \/.+\/[a-z]*: Unmatched '\)'$/;
const NOT_LOAD = /ERR_ACCESS_DENIED|EACCES|EPERM|ENOENT|Cannot find module|MODULE_NOT_FOUND|ERR_REQUIRE/;

/**
 * V4 load cases, per-entry diagnostics, record-only observations of non-gating generated
 * runtime files, then permission/credential controls.
 */
export function qualificationLoadCases(m: any, expected: Record<string, unknown> | null) {
  const credentials = githubControls(m).find((c) => c.id === "no-credentials")!,
    gating = moduleEntries(m),
    diagnostic = (kind: string, path: string) => ({
      id: kind + ":" + path,
      kind,
      program:
        "try{require(" +
        JSON.stringify("./" + path) +
        ");return {loaded:true};}catch(e){return {loaded:false,name:e.name,code:e.code===undefined?null:e.code,message:String(e.message).slice(0,300)};}",
      input: {},
      expected: kind === "diagnostic" ? { loaded: true } : null,
    });
  return [
    ...moduleLoadCases(m, expected),
    ...gating.map((path) => diagnostic("diagnostic", path)),
    ...m.generatedPaths
      .filter((p: string) => /\.(c|m)?js$/.test(p) && !gating.includes(p))
      .map((path: string) => diagnostic("observe", path)),
    {
      id: "control:package-read",
      kind: "control",
      program: "return require('./package.json').name;",
      input: {},
      expected: "regexparam",
    },
    { ...credentials, kind: "control" },
  ];
}

export function assessLoad(
  role: "original" | "candidate",
  guest: any,
  cases: any[],
  generatedHashes: Record<string, string>,
  runtimeVersion: string,
) {
  const rows = guest?.rows ?? [];
  if (
    rows.length !== cases.length ||
    guest.total !== cases.length ||
    rows.some((r: any, i: number) => r.id !== cases[i].id)
  )
    throw Error("Incomplete load qualification receipt");
  const of = (kind: string) => ({
      rows: rows.filter((_: any, i: number) => cases[i].kind === kind),
      cases: cases.filter((c) => c.kind === kind),
    }),
    load = of("load"),
    diagnostics = of("diagnostic").rows,
    observed = of("observe").rows.map((r: any) => ({
      path: r.id.slice(8),
      sha256: generatedHashes[r.id.slice(8)] ?? null,
      actual: r.actual,
    }));
  for (const r of of("control").rows)
    if (!r.passed) throw Error("Load qualification control failed: " + r.id);
  const gate = { rows: load.rows, total: load.rows.length };
  if (role === "original") {
    const baseline = moduleLoadBaseline(
      gate,
      load.cases,
      generatedHashes,
      runtimeVersion,
    );
    for (const [path, shape] of Object.entries(baseline))
      if (!isDeepStrictEqual(shape, moduleQualificationSettings.expectedShape))
        throw Error("Original export shape differs: " + path);
    for (const r of diagnostics)
      if (!r.passed) throw Error("Original diagnostic load failed: " + r.id);
    return { baseline, observed };
  }
  try {
    assertModuleLoad(gate, load.cases, generatedHashes, runtimeVersion);
  } catch (e) {
    if (
      !(e instanceof ModuleAdmissionError) ||
      e.kind !== "module_load" ||
      !/Invalid regular expression/.test(e.message)
    )
      throw Error("Candidate rejected for a non-load reason: " + (e as Error).message);
    const entries = load.rows.map((r: any, i: number) => {
      const d = diagnostics[i];
      let message = "";
      try {
        message = String(JSON.parse(r.error).error);
      } catch {}
      if (
        r.valid ||
        d?.id !== "diagnostic:" + r.id.slice(5) ||
        !LOAD_ERROR.test(message) ||
        NOT_LOAD.test(message) ||
        d.actual?.loaded !== false ||
        d.actual.name !== "SyntaxError" ||
        d.actual.code !== null ||
        String(d.actual.message).slice(0, 300) !== message.slice(0, 300)
      )
        throw Error("Entry did not fail specifically at module load: " + r.id);
      return { path: r.id.slice(5), sha256: generatedHashes[r.id.slice(5)], error: message };
    });
    return { gate: { kind: e.kind, message: e.message }, entries, observed };
  }
  throw Error("Candidate module unexpectedly loaded");
}

export async function qualifyModuleAdmission(signal: AbortSignal) {
  auditModuleQualification();
  const directory = join(MODULE_QUALIFICATION_ROOT, moduleQualificationSettings.task);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const path = join(directory, "result.json");
  if (existsSync(path))
    throw Error("Qualification slot already used; no automatic retry");
  const r: any = {
    format: moduleQualificationSettings.format,
    freeze: MODULE_QUALIFICATION_FREEZE,
    id: randomUUID(),
    status: "STARTED",
    startedAt: new Date().toISOString(),
    inferenceCalls: 0,
    executionCount: 0,
    operations: [],
    observed: {},
    provenance: {
      inference: "none",
      execution:
        "nebius-sandbox; qualified original regexparam image and two rejected V3 candidate images; no model call",
    },
  };
  await saveCross(path, r, true);
  const persist = () => saveCross(path, r),
    releases: (() => Promise<void>)[] = [];
  try {
    const { m, q, candidates } = qualificationInputs();
    releases.push(await acquireRepairLease(".repolab", r.id));
    releases.push(await acquireRepairLease(".repolab/repositories", r.id));
    const remote = new CrossRepoSandbox(directory, sandboxConfigFromEnv(), signal);
    const dispatch = async (
      label: string,
      config: any,
      inputs: Record<string, [Buffer, string]>,
      request: (files: Record<string, unknown>) => any,
      parse: (raw: any) => any,
    ) => {
      auditModuleQualification();
      signal.throwIfAborted();
      if (moduleQualificationSettings.operations[r.executionCount++] !== label)
        throw Error("Qualification operation order or limit changed");
      r.status = label;
      await persist();
      await saveCross(join(directory, label + "-config.json"), config, true);
      const files: Record<string, unknown> = {};
      for (const [p, [bytes, mode]] of Object.entries(inputs))
        files["/opt/repolab/cross/" + p] = await remote.upload(
          bytes,
          label + "-" + p.replace(/\./g, "-"),
          mode,
        );
      const raw = await remote.run(label, request(files)),
        proof = parse(raw);
      // Observations are recorded before any expectation is compared.
      r.observed[label] = proof.guest;
      r.operations.push({
        label,
        id: proof.id,
        image: raw.request.image,
        receiptSha256: crossSha(readFileSync(join(directory, label + ".json"))),
        configSha256: crossSha(readFileSync(join(directory, label + "-config.json"))),
        executionRuntimeVersion: proof.executionRuntimeVersion ?? null,
      });
      await persist();
      return proof;
    };
    const syntaxConfig = {
      format: "repolab-module-syntax-qualification/v1",
      nonce: randomUUID(),
      taskId: m.id,
      phase: "qualification-syntax",
      sourceHash: crossSourceHash(m, m.sources),
      runtimeVersion: moduleQualificationSettings.loadRuntime,
      expectedFiles: {
        "package.json": m.files["package.json"].sha256,
        "src/index.js": m.files["src/index.js"].sha256,
        ...q.generatedHashes,
      },
      controls: syntaxControlContents(m, candidates),
    };
    const syntax = await dispatch(
      "qual-syntax",
      syntaxConfig,
      {
        "qualify.cjs": [readFileSync("repositories/module-admission-v1/qualify.cjs"), "0444"],
        "qualify-config.json": [Buffer.from(JSON.stringify(syntaxConfig)), "0400"],
      },
      (files) => qualificationRequest(q.originalImage, files),
      (raw) => parseCrossReceipt(raw, syntaxConfig),
    );
    r.syntax = assessSyntax(syntax.guest, syntaxConfig);
    await persist();
    const load = async (
      label: string,
      image: string,
      sources: Record<string, string>,
      generatedHashes: Record<string, string>,
      cases: any[],
    ) => {
      const c = githubRepairConfig(m, sources, "observations", cases, generatedHashes);
      const proof = await dispatch(
        label,
        c,
        { "config.json": [Buffer.from(JSON.stringify(c)), "0400"] },
        (files) => ({ ...crossRequest(image, files, "observations"), networking: { enabled: false } }),
        (raw) => parseGithubRuntimeReceipt(raw, c),
      );
      assertGithubIsolation(proof, c);
      return proof;
    };
    // Every frozen operation runs once its predecessors are accepted; any failure stops the slot.
    const originalCases = qualificationLoadCases(m, null),
      original = await load("qual-load-original", q.originalImage, m.sources, q.generatedHashes, originalCases);
    r.original = assessLoad("original", original.guest, originalCases, q.generatedHashes, original.executionRuntimeVersion);
    await persist();
    r.candidates = [];
    for (const c of candidates) {
      const cases = qualificationLoadCases(m, r.original.baseline).map((v) =>
          v.kind === "diagnostic" ? { ...v, expected: null } : v,
        ),
        proof = await load("qual-load-c" + c.attempt, c.image, c.sources, c.generatedHashes, cases);
      r.candidates.push({
        attempt: c.attempt,
        image: c.image,
        ...assessLoad("candidate", proof.guest, cases, c.generatedHashes, proof.executionRuntimeVersion),
      });
      await persist();
    }
    r.status = "QUALIFIED";
  } catch (error) {
    r.failedPhase = r.status;
    r.status = "QUALIFICATION_FAILED";
    r.error = error instanceof Error ? error.message : "Qualification failed";
  } finally {
    r.executionUncertain = false;
    for (const file of await readdir(directory)) {
      if (!/^qual-.*\.json$/.test(file) || file.endsWith("-config.json")) continue;
      const raw = JSON.parse(readFileSync(join(directory, file), "utf8"));
      if (raw.executionUncertain || raw.submissionUnconfirmed) r.executionUncertain = true;
    }
    r.completedAt = new Date().toISOString();
    await persist();
    if (!r.executionUncertain)
      for (const release of releases.reverse()) await release();
  }
  return r;
}
