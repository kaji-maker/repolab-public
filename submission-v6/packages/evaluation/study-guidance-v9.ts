import ts from "typescript";
import { commonTask } from "./study-adapters-v9.ts";
import type { CommonTask } from "./study-adapters-v9.ts";
import { commonRepairContext, commonRepairSystem } from "./study-policy-v5.ts";
import { focusedPublicFeedback } from "./study-feedback-v7.ts";
import { sha256 } from "../evidence/hash.ts";

/** Trace fixed JSON public inputs as data. Never load or execute repository source. */
function publicExitExample(probe: any) {
  let value: any = probe.args[0],
    p = 0;
  const key = probe.args[1],
    segments: string[] = typeof key === "string" ? key.split(".") : key.slice();
  const reads: any[] = [];
  const encode = (x: unknown) =>
    x === undefined ? "undefined" : JSON.stringify(x);
  while (value && p < segments.length) {
    const segment = segments[p++];
    value = Object.prototype.hasOwnProperty.call(value, segment)
      ? value[segment]
      : undefined;
    reads.push({ segment, pAfterRead: p, originalValueJson: encode(value) });
  }
  return {
    id: probe.id,
    inputHash: sha256(JSON.stringify(probe.args)),
    reads,
    pAtExit: p,
    pathLength: segments.length,
    allSegmentsAttempted: p === segments.length,
    originalValueJson: encode(value),
    finalValueUndefined: value === undefined,
    suppliedExpectedJson: probe.expected,
    provenance:
      "reviewed data-only trace of this existing public JSON input; no candidate or upstream source execution",
  };
}
export function pathAwareRepairContext(
  task: string,
  source: string,
  path: string,
) {
  const context = commonRepairContext(task, source, path);
  if (task !== "dlv-null-path") return context;
  const original = commonTask(task);
  if (source !== original.source || path !== original.path)
    throw Error("Path guidance source identity changed");
  const file = ts.createSourceFile(
    "original.js",
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.JS,
  );
  const fn = file.statements.find(ts.isFunctionDeclaration);
  if (!fn?.body || fn.body.statements.length !== 4)
    throw Error("Path guidance source evidence missing");
  const sourceQuotes = fn.body.statements.map((s) => s.getText(file));
  const ids = [
    "reported-null-path",
    "reported-leaf-null",
    "documented-missing-path",
    "zero-child",
    "public-leaf-zero",
  ];
  const publicProbes = [...original.core, ...original.challenge];
  const examples = ids.map((id) => {
    const probe = publicProbes.find((p) => p.id === id);
    if (!probe) throw Error("Path guidance public example missing");
    return publicExitExample(probe);
  });
  return {
    ...context,
    pathExitFacts: {
      format: "repolab-source-path-guidance/v9",
      sourceHash: sha256(source),
      sourceQuotes,
      examples,
      scope:
        "These traces cover only the selected existing public JSON inputs and their own properties. They are not a general JavaScript interpreter or a new expected-behavior oracle.",
      requirements: [
        "The post-increment in the lookup counts an attempted read. A final missing property can therefore leave the counter equal to path length and the current value undefined.",
        "Retain the original undefined-default behavior as well as handling a path that stopped before its final segment.",
        "Preserve completed null, zero, false and empty-string leaves; distinguish them from an unfinished path through those same values.",
        "Change only the supplied return expression; retain string/array path handling and every original test. Use supplied expected values, not invented behavior.",
      ],
    },
  };
}
export function pathAwareRepairSystem(task: string) {
  return (
    commonRepairSystem(task) +
    (task === "dlv-null-path"
      ? " Read pathExitFacts before proposing. The loop counter counts attempted property reads, not successful lookups. Preserve original undefined-default handling, unfinished-path defaults and completed falsy leaf values together. No new expected behavior or permission to change tests is supplied."
      : "")
  );
}

const unwrap = (n: ts.Expression): ts.Expression =>
  ts.isParenthesizedExpression(n) ? unwrap(n.expression) : n;
/** Advisory syntax check only. Actual tests remain the acceptance authority. */
export function pathDiagnostics(task: string, proposal: any) {
  if (task !== "dlv-null-path") return [];
  if (
    !Array.isArray(proposal.edits) ||
    proposal.edits.length !== 1 ||
    typeof proposal.edits[0].after !== "string"
  )
    throw Error("Path diagnostic proposal shape invalid");
  const file = ts.createSourceFile(
    "expression.js",
    "const value=(" + proposal.edits[0].after + ");",
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.JS,
  );
  if (
    (file as any).parseDiagnostics.length ||
    file.statements.length !== 1 ||
    !ts.isVariableStatement(file.statements[0])
  )
    throw Error("Path diagnostic expression parse failed");
  const root = file.statements[0].declarationList.declarations[0].initializer;
  if (!root) throw Error("Path diagnostic expression missing");
  let undefinedComparison = false;
  const obj = (n: ts.Expression) =>
    ts.isIdentifier(unwrap(n)) && (unwrap(n) as ts.Identifier).text === "obj";
  const undef = (n: ts.Expression) => {
    const x = unwrap(n);
    return (
      (ts.isIdentifier(x) && x.text === "undefined") ||
      (ts.isVoidExpression(x) &&
        ts.isNumericLiteral(unwrap(x.expression)) &&
        (unwrap(x.expression) as ts.NumericLiteral).text === "0")
    );
  };
  const visit = (node: ts.Node) => {
    if (
      ts.isBinaryExpression(node) &&
      [
        ts.SyntaxKind.EqualsEqualsToken,
        ts.SyntaxKind.EqualsEqualsEqualsToken,
        ts.SyntaxKind.ExclamationEqualsToken,
        ts.SyntaxKind.ExclamationEqualsEqualsToken,
      ].includes(node.operatorToken.kind) &&
      ((obj(node.left) && undef(node.right)) ||
        (undef(node.left) && obj(node.right)))
    )
      undefinedComparison = true;
    ts.forEachChild(node, visit);
  };
  visit(root);
  return undefinedComparison
    ? []
    : [
        {
          code: "FINAL_UNDEFINED_UNCHECKED",
          message:
            "An explicit comparison of the current value with undefined is not evident. The final lookup can produce undefined after the counter reaches path length. Retain the original undefined-default behavior. This conservative warning is advisory and does not change admission or predict test results.",
        },
      ];
}
export function pathAwareCandidateFeedback(
  task: CommonTask,
  proposal: any,
  gates: any[],
) {
  return {
    ...focusedPublicFeedback(task, gates),
    pathDiagnostics: pathDiagnostics(task.id, proposal),
  };
}
