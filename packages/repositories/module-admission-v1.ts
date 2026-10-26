import { readFileSync } from "node:fs";
import ts from "typescript";
import { crossSha } from "../execution/cross-repo-sandbox-v1.ts";

export class ModuleAdmissionError extends Error {
  readonly kind: "static_syntax" | "static_regex" | "module_load" | "load_inventory";
  constructor(kind: ModuleAdmissionError["kind"], message: string) {
    super(message);
    this.kind = kind;
  }
}

const RUNTIME_ENTRY = /\.(c|m)?js$/;

/**
 * Static candidate admission. Parses and type-checks source text only; nothing is
 * evaluated on the controller. V1 Sandbox `node --check` rows do not bind a module
 * goal and exit 0 for ESM-syntax `.js` files outside `"type":"module"`, so they
 * cannot admit those files on their own.
 */
export function staticSourceAdmission(m: any, sources: Record<string, string>) {
  const rows = m.sourcePaths.map((path: string) => {
    const text = sources[path];
    if (typeof text !== "string" || !path.endsWith(".js"))
      throw new ModuleAdmissionError(
        "static_syntax",
        "Static admission requires closed JavaScript source: " + path,
      );
    const name = "/repolab-static/" + path,
      file = ts.createSourceFile(
        name,
        text,
        ts.ScriptTarget.ESNext,
        true,
        ts.ScriptKind.JS,
      ),
      host = ts.createCompilerHost({});
    host.getSourceFile = (n) => (n === name ? file : undefined);
    host.fileExists = (n) => n === name;
    host.readFile = (n) => (n === name ? text : undefined);
    const program = ts.createProgram(
        [name],
        {
          allowJs: true,
          checkJs: true,
          noEmit: true,
          noLib: true,
          noResolve: true,
          types: [],
          target: ts.ScriptTarget.ESNext,
        },
        host,
      ),
      regexSpans: [number, number][] = [];
    const visit = (node: ts.Node) => {
      if (node.kind === ts.SyntaxKind.RegularExpressionLiteral)
        regexSpans.push([node.getStart(file), node.end]);
      ts.forEachChild(node, visit);
    };
    visit(file);
    const inRegex = (d: ts.Diagnostic) =>
      d.start !== undefined &&
      regexSpans.some(([s, e]) => d.start! >= s && d.start! < e);
    const describe = (d: ts.Diagnostic, regex: boolean) => {
      const at = file.getLineAndCharacterOfPosition(d.start ?? 0);
      return {
        code: d.code,
        regex,
        line: at.line + 1,
        column: at.character + 1,
        message: ts.flattenDiagnosticMessageText(d.messageText, " ").slice(0, 300),
      };
    };
    const diagnostics = [
      ...program.getSyntacticDiagnostics(file).map((d) => describe(d, inRegex(d))),
      ...program
        .getSemanticDiagnostics(file)
        .filter(inRegex)
        .map((d) => describe(d, true)),
    ];
    return {
      path,
      sha256: crossSha(text),
      goal: ts.isExternalModule(file) ? "module" : "script",
      diagnostics,
    };
  });
  const receipt = {
    format: "repolab-static-source-admission/v1",
    parser: "typescript@" + ts.version,
    rows,
  };
  for (const row of rows)
    for (const d of row.diagnostics)
      throw new ModuleAdmissionError(
        d.regex ? "static_regex" : "static_syntax",
        `Static source admission rejected ${row.path}:${d.line}:${d.column} TS${d.code} ${d.message}`,
      );
  return receipt;
}

/**
 * Gating runtime entries: `main`, `module` and `exports` JavaScript targets, each of which
 * must be a generated file. Generated files reachable only otherwise (e.g. `unpkg` builds)
 * are not gated.
 */
export function moduleEntries(m: any) {
  const generated = m.generatedPaths.filter((p: string) => RUNTIME_ENTRY.test(p));
  const bytes = readFileSync(m.base + "/original/package.json");
  if (crossSha(bytes) !== m.files["package.json"]?.sha256)
    throw new ModuleAdmissionError("load_inventory", "Package manifest changed");
  const pkg = JSON.parse(bytes.toString()),
    targets: string[] = [];
  const collect = (v: unknown) => {
    if (typeof v === "string") targets.push(v);
    else if (v && typeof v === "object") Object.values(v).forEach(collect);
  };
  collect([pkg.main, pkg.module, pkg.exports]);
  const entries = [
    ...new Set(
      targets
        .map((t) => t.replace(/^\.\//, ""))
        .filter((t) => RUNTIME_ENTRY.test(t)),
    ),
  ].sort();
  if (!entries.length)
    throw new ModuleAdmissionError("load_inventory", "No package runtime entry");
  for (const t of entries)
    if (!generated.includes(t))
      throw new ModuleAdmissionError(
        "load_inventory",
        "Package entry outside generated inventory: " + t,
      );
  return entries;
}

/** Controller-generated observation cases; `expected` comes from the original-image baseline. */
export function moduleLoadCases(
  m: any,
  expected: Record<string, unknown> | null = null,
) {
  return moduleEntries(m).map((path) => ({
    id: "load:" + path,
    kind: "load",
    program:
      "const m=require(" +
      JSON.stringify("./" + path) +
      ");return {type:typeof m,keys:Object.keys(m).sort()};",
    input: {},
    expected: expected ? expected[path] : null,
  }));
}

/** `require()` of CJS, UMD and ESM entries was qualified with fixtures on this child runtime only. */
export const LOAD_RUNTIME = "v24.18.0";

function loadRows(
  guest: any,
  cases: any[],
  generatedHashes: Record<string, string>,
  runtimeVersion: string,
) {
  if (runtimeVersion !== LOAD_RUNTIME)
    throw new ModuleAdmissionError(
      "load_inventory",
      "Load runtime not qualified: " + String(runtimeVersion),
    );
  if (
    !Array.isArray(guest?.rows) ||
    guest.rows.length !== cases.length ||
    guest.total !== cases.length ||
    guest.rows.some((r: any, i: number) => r.id !== cases[i].id)
  )
    throw new ModuleAdmissionError("load_inventory", "Incomplete module load receipt");
  for (const p of cases.map((c) => c.id.slice(5)))
    if (!/^[a-f0-9]{64}$/.test(generatedHashes?.[p] ?? ""))
      throw new ModuleAdmissionError(
        "load_inventory",
        "Load entry lacks built hash: " + p,
      );
  return guest.rows.map((r: any, i: number) => ({
    path: cases[i].id.slice(5),
    sha256: generatedHashes[cases[i].id.slice(5)],
    ...r,
  }));
}

/** Original image: every entry must load cleanly; its observed shape becomes the expectation. */
export function moduleLoadBaseline(
  guest: any,
  cases: any[],
  generatedHashes: Record<string, string>,
  runtimeVersion: string,
) {
  const rows = loadRows(guest, cases, generatedHashes, runtimeVersion);
  for (const r of rows)
    if (!r.valid || r.error || !r.actual || !Array.isArray(r.actual.keys))
      throw new ModuleAdmissionError(
        "module_load",
        "Original module did not load: " + r.path,
      );
  return Object.fromEntries(rows.map((r: any) => [r.path, r.actual]));
}

/** Candidate image: every entry loads and keeps the original export shape, before behavior runs. */
export function assertModuleLoad(
  guest: any,
  cases: any[],
  generatedHashes: Record<string, string>,
  runtimeVersion: string,
) {
  if (cases.some((c) => !c.expected))
    throw new ModuleAdmissionError("load_inventory", "Load baseline required");
  const rows = loadRows(guest, cases, generatedHashes, runtimeVersion);
  const failed = rows.find((r: any) => !r.passed || !r.valid || r.error);
  if (failed) {
    let detail = "";
    try {
      detail = String(JSON.parse(failed.error ?? "{}").error ?? "");
    } catch {}
    throw new ModuleAdmissionError(
      "module_load",
      "Candidate module load failed " +
        failed.path +
        (detail ? ": " + detail.slice(0, 400) : failed.valid ? ": export shape changed" : ""),
    );
  }
  return {
    format: "repolab-module-load-admission/v1",
    runtimeVersion,
    rows: rows.map(({ path, sha256, actual }: any) => ({ path, sha256, actual })),
  };
}
