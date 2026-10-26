import { readFileSync } from "node:fs";
import { z } from "zod";
import ts from "typescript";
import { sha256 } from "../evidence/hash.ts";
import { readRepositorySnapshot } from "../repositories/prepare.ts";
import { auditGitHubPilot as auditPreviousPilot } from "./github-pilot.ts";
import {
  expressionSites,
  expressionPatchSchema,
  EditAdmissionError,
} from "./study-expression-edits-v3.ts";
import type { Execution } from "../contracts/index.ts";
import type { StudyRunSpec } from "./study-execution.ts";

export const frozenGitHubPilotDigest = "548b6a12599f09b280458c0f7d0e73874dd3c657b9ac5f02ab4ec382158ba632";
export const githubPilotAssets = [
  "packages/evaluation/github-pilot-v2.ts",
  "packages/evaluation/github-runner-v2.ts",
  "apps/evaluator/github-pilot-v2.ts",
  "evaluation/GITHUB_PILOT_V2.md",
  "tests/github-pilot-v2.test.ts",
] as const;
export function pilotAssetBytes(path: string) {
  const bytes = readFileSync(path, "utf8");
  return path === "packages/evaluation/github-pilot-v2.ts"
    ? bytes.replace(
        /export const frozenGitHubPilotDigest =\s*"[a-f0-9]{64}";/,
        'export const frozenGitHubPilotDigest = "' + "0".repeat(64) + '";',
      )
    : bytes;
}
export function auditGitHubPilot() {
  const m = z
    .strictObject({
      format: z.literal("repolab-github-pilot/v2"),
      digest: z.string().regex(/^[a-f0-9]{64}$/),
      previousStudyDigest: z.literal(
        "008ba9bfac8725821a8460acff559be94ca26d3333f1607c80cf8539211004e6",
      ),
      task: z.literal("dlv-nested-null"),
      scope: z.literal("one-revised-public-historical-development-task"),
      maxCandidates: z.literal(2),
      maxCalls: z.literal(3),
      maxOperations: z.literal(16),
      inferenceBudgetUsd: z.literal(0.1),
      model: z.literal("nvidia/nemotron-3-super-120b-a12b"),
      requestPolicy: z.literal("nemotron-low-effort-v1"),
      rates: z.strictObject({ input: z.literal(0.3), output: z.literal(0.9) }),
      assets: z.array(
        z.strictObject({
          path: z.string(),
          sha256: z.string().regex(/^[a-f0-9]{64}$/),
        }),
      ),
    })
    .parse(JSON.parse(readFileSync("evaluation/github-pilot-v2.json", "utf8")));
  const { digest, ...payload } = m;
  if (
    digest !== frozenGitHubPilotDigest ||
    sha256(JSON.stringify(payload)) !== digest ||
    auditPreviousPilot().digest !== m.previousStudyDigest ||
    m.assets.length !== githubPilotAssets.length ||
    m.assets.some(
      (a, i) =>
        a.path !== githubPilotAssets[i] ||
        sha256(pilotAssetBytes(a.path)) !== a.sha256,
    )
  )
    throw Error("GitHub pilot freeze mismatch");
  return m;
}
export function pilotTask() {
  const s = readRepositorySnapshot(
    JSON.parse(
      readFileSync("fixtures/dlv-upstream/original-snapshot.json", "utf8"),
    ),
  );
  const manifest = JSON.parse(
    readFileSync("repositories/dlv-null.case.json", "utf8"),
  );
  if (
    JSON.stringify(s.manifest) !== JSON.stringify(manifest) ||
    s.manifest.id !== "dlv-nested-null" ||
    s.manifest.commit !== "250e18e95f873c967cc465e50bdab501cbcffdd6" ||
    s.files.some((f) => f.role === "baseline" && f.path !== "test.js")
  )
    throw Error("Task identity mismatch");
  const file = (p: string) => s.files.find((f) => f.path === p)!.content;
  const source = file("index.js");
  if (
    sha256(source) !==
      "1962e2fb0d6d30da2d07941e2d76c37fa96c9032f492224101277ebe1215e337" ||
    sha256(file("test.js")) !==
      "33450718d09c9e7befb93bbd46a8f517d8b2fb35cba181059c6dafd332db8ce2"
  )
    throw Error("Original source/test mismatch");
  return {
    snapshot: s,
    source,
    test: file("test.js"),
    metadata: file("package.json"),
    notice: file("README.md"),
    report: s.manifest.report,
  };
}
export interface PilotProbe {
  id: string;
  args: unknown[];
  expected: string;
}
export const pilotCore: PilotProbe[] = [
  {
    id: "reported-null-path",
    args: [{ a: { c: 1, e: null } }, "a.e.f", "default"],
    expected: '"default"',
  },
];
export const pilotControls: PilotProbe[] = [
  {
    id: "reported-leaf-null",
    args: [{ a: { c: 1, e: null } }, "a.e", "default"],
    expected: "null",
  },
  {
    id: "documented-array-path",
    args: [{ a: { b: { c: 1 } } }, ["a", "b", "c"]],
    expected: "1",
  },
  {
    id: "documented-missing-path",
    args: [{ a: { b: { c: 1 } } }, "a.b.c.f", "foo"],
    expected: '"foo"',
  },
];
const pilotSourceQuote =
  'Given object {"a":{"c":1,"e":null}}, key "a.e.f", and default "default", dlv returns null but must return "default" because the complete path does not exist.';
export const pilotContractSchema = z.strictObject({
  format: z.literal("repolab-dlv-grounded-contract/v1"),
  object: z.strictObject({
    a: z.strictObject({ c: z.literal(1), e: z.null() }),
  }),
  key: z.literal("a.e.f"),
  defaultValue: z.literal("default"),
  expected: z.literal("default"),
  sourceQuote: z.literal(pilotSourceQuote),
});
export function groundPilotContract(value: unknown, report: string) {
  const c = pilotContractSchema.parse(value);
  const exact =
    'Given object {"a":{"c":1,"e":null}}, key "a.e.f", and default "default", dlv returns null but must return "default" because the complete path does not exist.';
  if (c.sourceQuote !== exact || !report.includes(exact))
    throw Error("UNGROUNDED_CONTRACT");
  return c;
}
/** Only the original return expression is editable. No newly executable statements or calls. */
export function applyPilotPatch(input: unknown) {
  const source = pilotTask().source;
  const patch = expressionPatchSchema(source, "index.js").parse(input);
  const sites = expressionSites(source);
  if (sites.length !== 1 || patch.edits.length !== 1)
    throw new EditAdmissionError("SITE_LIMIT");
  const e = patch.edits[0],
    site = sites[0];
  if (e.siteId !== site.id || e.before !== site.before || e.after === e.before)
    throw new EditAdmissionError("BEFORE_MISMATCH");
  const scan = ts.createScanner(
    ts.ScriptTarget.Latest,
    false,
    ts.LanguageVariant.Standard,
    e.after,
  );
  for (
    let token = scan.scan();
    token !== ts.SyntaxKind.EndOfFileToken;
    token = scan.scan()
  )
    if (
      [
        ts.SyntaxKind.SingleLineCommentTrivia,
        ts.SyntaxKind.MultiLineCommentTrivia,
      ].includes(token)
    )
      throw new EditAdmissionError("COMMENT_IN_EXPRESSION");
  const f = ts.createSourceFile(
    "edit.js",
    "const __edit = (\n" + e.after + "\n);",
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.JS,
  );
  if (
    (f as any).parseDiagnostics.length ||
    f.statements.length !== 1 ||
    !ts.isVariableStatement(f.statements[0]) ||
    f.statements[0].declarationList.declarations.length !== 1
  )
    throw new EditAdmissionError("EXPRESSION_SYNTAX");
  const init = f.statements[0].declarationList.declarations[0].initializer;
  if (!init || !ts.isParenthesizedExpression(init))
    throw new EditAdmissionError("EXPRESSION_SHAPE");
  const allowed = new Set([
    ts.SyntaxKind.ParenthesizedExpression,
    ts.SyntaxKind.BinaryExpression,
    ts.SyntaxKind.ConditionalExpression,
    ts.SyntaxKind.Identifier,
    ts.SyntaxKind.PropertyAccessExpression,
    ts.SyntaxKind.ElementAccessExpression,
    ts.SyntaxKind.NumericLiteral,
    ts.SyntaxKind.StringLiteral,
    ts.SyntaxKind.NullKeyword,
    ts.SyntaxKind.TrueKeyword,
    ts.SyntaxKind.FalseKeyword,
    ts.SyntaxKind.PrefixUnaryExpression,
    ts.SyntaxKind.QuestionToken,
    ts.SyntaxKind.ColonToken,
    ts.SyntaxKind.BarBarToken,
    ts.SyntaxKind.AmpersandAmpersandToken,
    ts.SyntaxKind.EqualsEqualsToken,
    ts.SyntaxKind.EqualsEqualsEqualsToken,
    ts.SyntaxKind.ExclamationEqualsToken,
    ts.SyntaxKind.ExclamationEqualsEqualsToken,
    ts.SyntaxKind.LessThanToken,
    ts.SyntaxKind.LessThanEqualsToken,
    ts.SyntaxKind.GreaterThanToken,
    ts.SyntaxKind.GreaterThanEqualsToken,
    ts.SyntaxKind.PlusToken,
    ts.SyntaxKind.MinusToken,
    ts.SyntaxKind.ExclamationToken,
  ]);
  const visit = (n: ts.Node) => {
    if (!allowed.has(n.kind))
      throw new EditAdmissionError("UNSAFE_EXPRESSION_FORM");
    if (
      ts.isIdentifier(n) &&
      !["obj", "key", "def", "p", "undefined", "length"].includes(n.text)
    )
      throw new EditAdmissionError("AMBIENT_NAME");
    if (
      ts.isIdentifier(n) &&
      n.text === "length" &&
      !(ts.isPropertyAccessExpression(n.parent) && n.parent.name === n)
    )
      throw new EditAdmissionError("AMBIENT_NAME");
    if (
      ts.isPropertyAccessExpression(n) &&
      (!ts.isIdentifier(n.expression) ||
        !["obj", "key"].includes(n.expression.text) ||
        n.name.text !== "length")
    )
      throw new EditAdmissionError("MEMBER_UNSUPPORTED");
    if (
      ts.isElementAccessExpression(n) &&
      (!ts.isIdentifier(n.expression) ||
        !["obj", "key"].includes(n.expression.text) ||
        !n.argumentExpression ||
        !(
          ts.isNumericLiteral(n.argumentExpression) ||
          (ts.isIdentifier(n.argumentExpression) &&
            n.argumentExpression.text === "p")
        ))
    )
      throw new EditAdmissionError("INDEX_FORM");
    if (
      ts.isPrefixUnaryExpression(n) &&
      ![
        ts.SyntaxKind.ExclamationToken,
        ts.SyntaxKind.PlusToken,
        ts.SyntaxKind.MinusToken,
      ].includes(n.operator)
    )
      throw new EditAdmissionError("UNARY_FORM");
    ts.forEachChild(n, visit);
  };
  visit(init);
  const assembled =
    source.slice(0, site.start) + e.after + source.slice(site.end);
  const full = ts.createSourceFile(
    "module.mjs",
    assembled,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.JS,
  );
  if (
    (full as any).parseDiagnostics.length ||
    full.statements.length !== 1 ||
    !ts.isFunctionDeclaration(full.statements[0])
  )
    throw new EditAdmissionError("MODULE_SYNTAX");
  return { source: assembled, sourceHash: sha256(assembled), patch };
}
export function oraclePilot() {
  return z
    .strictObject({
      format: z.literal("repolab-dlv-oracle/v1"),
      referenceAfter: z.string(),
      weakAfter: z.string(),
      cases: z
        .array(
          z.strictObject({
            id: z.string().regex(/^[a-z][a-z0-9-]{0,63}$/),
            args: z.array(z.unknown()).min(2).max(3),
            expected: z.string(),
          }),
        )
        .length(16),
      basis: z.array(z.string()),
      scope: z.string(),
    })
    .parse(JSON.parse(readFileSync("evaluation/dlv-null-oracle.json", "utf8")));
}
export function reviewedPilotSource(after: string) {
  const t = pilotTask(),
    site = expressionSites(t.source)[0];
  return applyPilotPatch({
    format: "repolab-expression-patch/v3",
    path: "index.js",
    baseSourceHash: sha256(t.source),
    edits: [{ siteId: site.id, before: site.before, after }],
    explanation: "Reviewed qualification control; not model-generated.",
  }).source;
}
function substitute(template: string, key: string, value: unknown) {
  if (template.split(key).length !== 2) throw Error("Runner template mismatch");
  return template.replace(key, () => JSON.stringify(value));
}
export function baselinePilotSpec(source: string): StudyRunSpec {
  const t = pilotTask(),
    root = "/tmp/repolab/github";
  if (!source.startsWith("export default function dlv("))
    throw Error("Source export mismatch");
  // Explicit, frozen syntax adapter, with no execution or semantic edits on the host.
  const cjs =
    source.slice("export default ".length) + "\nmodule.exports = dlv;\n";
  const files = [
    { path: root + "/index.mjs", content: source },
    { path: root + "/test.js", content: t.test },
    { path: root + "/package.json", content: t.metadata },
    { path: root + "/README.md", content: t.notice },
    { path: root + "/dist/dlv.js", content: cjs },
    {
      path: root + "/preload.cjs",
      content: readFileSync("repositories/dlv-pilot/preload.cjs", "utf8"),
    },
  ];
  const inputs = Object.fromEntries(
    files.map((f) => [f.path, sha256(f.content)]),
  );
  const runner = substitute(
    readFileSync("repositories/dlv-pilot/baseline-runner.mjs", "utf8"),
    "__INPUTS__",
    inputs,
  );
  return {
    phase: "baseline",
    files: [
      ...files,
      { path: "/opt/repolab/baseline-runner.mjs", content: runner },
    ],
    sourceHash: sha256(source),
    testHash: sha256(runner),
  };
}
export function observationPilotSpec(
  source: string,
  probes: PilotProbe[],
): StudyRunSpec {
  if (
    !probes.length ||
    probes.length > 32 ||
    new Set(probes.map((p) => p.id)).size !== probes.length
  )
    throw Error("Probe identity mismatch");
  const path = "/tmp/repolab/module.mjs",
    inputs = { [path]: sha256(source) };
  let runner = substitute(
    readFileSync("repositories/dlv-pilot/observer.mjs", "utf8"),
    "__INPUTS__",
    inputs,
  );
  runner = substitute(
    runner,
    "__PROBES__",
    probes.map(({ id, args }) => ({ id, args })),
  );
  return {
    phase: "observations",
    files: [
      { path, content: source },
      { path: "/tmp/repolab/test.mjs", content: runner },
    ],
    sourceHash: sha256(source),
    testHash: sha256(runner),
  };
}
export function checkPilotExecution(
  e: Execution,
  spec: StudyRunSpec,
  image: string,
) {
  if (
    e.provider !== "nebius-sandbox" ||
    e.image !== image ||
    e.runtimeVersion !== "v24.18.0" ||
    !z.uuid().safeParse(e.id).success ||
    !z.uuid().safeParse(e.operationId).success ||
    e.sourceHash !== spec.sourceHash ||
    e.testHash !== spec.testHash ||
    e.timedOut !== false ||
    e.truncated !== false ||
    e.signal !== null ||
    ![0, 1].includes(e.exitCode!) ||
    Buffer.byteLength(e.stdout) > 65536
  )
    throw Error("Execution provenance or completeness mismatch");
}
export function checkPilotBaseline(
  e: Execution,
  source: string,
  image: string,
) {
  const spec = baselinePilotSpec(source);
  checkPilotExecution(e, spec, image);
  const hashes = Object.fromEntries(
    spec.files.slice(0, -1).map((f) => [f.path, sha256(f.content)]),
  );
  const body = z
    .strictObject({
      protocol: z.literal("repolab-dlv-upstream/v1"),
      runtimeVersion: z.literal("v24.18.0"),
      adapter: z.literal("exact-export-prefix-removal-plus-commonjs-footer/v1"),
      protectedInputs: z.boolean(),
      protectedDirectories: z.boolean(),
      controls: z
        .array(z.strictObject({ name: z.string(), denied: z.boolean() }))
        .length(9),
      before: z.record(z.string(), z.string()),
      after: z.record(z.string(), z.string()),
      child: z
        .strictObject({
          exitCode: z.number().int().nullable(),
          signal: z.string().nullable(),
          error: z.string().nullable(),
          stdout: z.string().max(16384),
          stderr: z.string().max(16384),
        })
        .nullable(),
    })
    .parse(JSON.parse(e.stdout));
  const controls = [
    "write-source",
    "write-test",
    "write-adapter",
    "write-metadata",
    "write-preload",
    "unlink-source",
    "rename-source",
    "chmod-source",
    "create-module",
  ];
  if (
    e.exitCode !== 0 ||
    JSON.stringify(body.before) !== JSON.stringify(hashes) ||
    JSON.stringify(body.after) !== JSON.stringify(hashes) ||
    !body.protectedInputs ||
    !body.protectedDirectories ||
    body.controls.some((c, i) => c.name !== controls[i] || !c.denied)
  )
    throw Error("Baseline integrity counterexample failed");
  const a = body.child?.stderr.match(/REPOLAB_ASSERTIONS:(\{[^\n]+\})/g) ?? [];
  const count =
    a.length === 1
      ? z
          .strictObject({ count: z.number().int() })
          .parse(JSON.parse(a[0].slice("REPOLAB_ASSERTIONS:".length))).count
      : null;
  const passed =
    body.child?.exitCode === 0 &&
    body.child.signal === null &&
    body.child.error === null &&
    count === 34 &&
    body.child.stdout.endsWith("✅ Success!\n");
  return {
    passed,
    assertionCount: count,
    protectedInputs: true,
    filesystemDenials: 9,
    childExit: body.child?.exitCode ?? null,
  };
}
export function checkPilotObservation(
  e: Execution,
  source: string,
  image: string,
  probes: PilotProbe[],
) {
  const spec = observationPilotSpec(source, probes);
  checkPilotExecution(e, spec, image);
  const row = z.union([
    z.strictObject({
      id: z.string(),
      status: z.literal("returned"),
      actual: z.string().max(4000),
    }),
    z.strictObject({
      id: z.string(),
      status: z.enum(["threw", "unsupported"]),
    }),
  ]);
  const body = z
    .strictObject({
      protocol: z.literal("repolab-github-observations/v1"),
      runtimeVersion: z.literal("v24.18.0"),
      observations: z.array(row).min(1).max(32),
    })
    .parse(JSON.parse(e.stdout));
  if (
    body.observations.length !== probes.length ||
    new Set(body.observations.map((o) => o.id)).size !== probes.length ||
    e.exitCode !==
      (body.observations.some((o) => o.status !== "returned") ? 1 : 0)
  )
    throw Error("Incomplete observations or inconsistent exit");
  return probes.map((p) => {
    const o = body.observations.find((o) => o.id === p.id);
    if (!o) throw Error("Missing observation");
    return {
      id: p.id,
      status: o.status,
      actual: o.status === "returned" ? o.actual : null,
      expected: p.expected,
      passed: o.status === "returned" && o.actual === p.expected,
    };
  });
}
