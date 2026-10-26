import ts from "typescript";
import { z } from "zod";
import { admitPreactEdit, preactRepairContext } from "./preact-admission-v5.ts";

type Issue = {
  code: string;
  subject: string;
  actual: string;
  required: string;
  offset: number;
};
const bindings: Record<string, string> = {
  cleanup: "refVNode._refCleanup",
  result: "ref(value)",
};
const writes = new Set(["refVNode._refCleanup", "ref.current"]);
/** Parse only. These diagnostics never execute source or change admission/selection. */
export function preactBodyDiagnostics(body: unknown) {
  const issues: Issue[] = [];
  const typeWarnings: Issue[] = [];
  if (typeof body !== "string" || body.length > 1800)
    return {
      format: "repolab-preact-body-diagnostics/v2",
      issues,
      typeWarnings,
      parsed: false,
      authority:
        "advisory only; frozen admission and native lint remain authoritative",
    };
  const prefix = "function diagnostic(ref,value,vnode,refVNode){";
  const file = ts.createSourceFile(
    "candidate.js",
    prefix + body + "}",
    ts.ScriptTarget.ES2023,
    true,
    ts.ScriptKind.JS,
  );
  const fn = file.statements[0];
  if (
    (file as ts.SourceFile & { parseDiagnostics: unknown[] }).parseDiagnostics
      .length ||
    file.statements.length !== 1 ||
    !ts.isFunctionDeclaration(fn) ||
    !fn.body
  )
    return {
      format: "repolab-preact-body-diagnostics/v2",
      issues,
      typeWarnings,
      parsed: false,
      authority:
        "advisory only; frozen admission and native lint remain authoritative",
    };
  const row = (
    n: ts.Node,
    code: string,
    subject: string,
    actual: string,
    required: string,
  ): Issue => ({
    code,
    subject: subject.slice(0, 120),
    actual: actual.slice(0, 120),
    required,
    offset: Math.max(0, n.getStart(file) - prefix.length),
  });
  const declared = new Set<string>();
  const inspect = (n: ts.Node) => {
    if (ts.isCallExpression(n)) {
      const target = n.expression.getText(file);
      if (!["ref", "cleanup"].includes(target))
        issues.push(
          row(
            n,
            "CALL_TARGET",
            target,
            n.getText(file),
            "Only ref(value) and cleanup() are admitted. Bind stored cleanup with const cleanup = refVNode._refCleanup; invoke the local after checking it.",
          ),
        );
      else if (
        (target === "ref" &&
          (n.arguments.length !== 1 ||
            n.arguments[0].getText(file) !== "value")) ||
        (target === "cleanup" && n.arguments.length !== 0)
      )
        issues.push(
          row(
            n,
            "CALL_ARGUMENTS",
            target,
            n.getText(file),
            target === "ref" ? "ref(value)" : "cleanup()",
          ),
        );
    }
    if (ts.isVariableDeclaration(n)) {
      const name = n.name.getText(file),
        initializer = n.initializer?.getText(file) ?? "missing";
      if (!(name in bindings))
        issues.push(
          row(
            n,
            "LOCAL_NAME",
            name,
            initializer,
            "Only cleanup and result locals are admitted.",
          ),
        );
      else {
        if (declared.has(name))
          issues.push(
            row(
              n,
              "DUPLICATE_LOCAL",
              name,
              initializer,
              "Declare each admitted local once.",
            ),
          );
        declared.add(name);
        const valid =
          name === "cleanup"
            ? initializer === bindings[name]
            : /^ref\(\s*value\s*\)$/.test(initializer);
        if (!valid)
          issues.push(
            row(n, "LOCAL_INITIALIZER", name, initializer, bindings[name]),
          );
      }
    }
    if (
      ts.isBinaryExpression(n) &&
      n.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      !writes.has(n.left.getText(file))
    )
      issues.push(
        row(
          n,
          "WRITE_TARGET",
          n.left.getText(file),
          n.getText(file),
          "Write only refVNode._refCleanup or ref.current; locals and parameters cannot be reassigned.",
        ),
      );
    ts.forEachChild(n, inspect);
  };
  inspect(fn.body);

  // Conservative callable facts for the admitted expression/statement subset.
  // A warning is not a TypeScript verdict; native tsc and original tests decide.
  const intersect = (a: Set<string>, b: Set<string>) =>
    new Set([...a].filter((x) => b.has(x)));
  const plus = (a: Set<string>, b: Set<string>) => new Set([...a, ...b]);
  const guard = (n: ts.Expression, truth: boolean): Set<string> => {
    if (ts.isParenthesizedExpression(n)) return guard(n.expression, truth);
    if (
      ts.isPrefixUnaryExpression(n) &&
      n.operator === ts.SyntaxKind.ExclamationToken
    )
      return guard(n.operand, !truth);
    if (ts.isIdentifier(n) && n.text === "cleanup" && truth)
      return new Set(["cleanup"]);
    if (ts.isBinaryExpression(n)) {
      const op = n.operatorToken.kind;
      if (op === ts.SyntaxKind.AmpersandAmpersandToken)
        return truth
          ? plus(guard(n.left, true), guard(n.right, true))
          : intersect(guard(n.left, false), guard(n.right, false));
      if (op === ts.SyntaxKind.BarBarToken)
        return truth
          ? intersect(guard(n.left, true), guard(n.right, true))
          : plus(guard(n.left, false), guard(n.right, false));
      const positive = [
        ts.SyntaxKind.EqualsEqualsToken,
        ts.SyntaxKind.EqualsEqualsEqualsToken,
      ].includes(op);
      const negative = [
        ts.SyntaxKind.ExclamationEqualsToken,
        ts.SyntaxKind.ExclamationEqualsEqualsToken,
      ].includes(op);
      if ((positive || negative) && truth === positive) {
        const pairs = [
          [n.left, n.right],
          [n.right, n.left],
        ];
        for (const [a, b] of pairs)
          if (
            ts.isTypeOfExpression(a) &&
            ts.isIdentifier(a.expression) &&
            ["ref", "cleanup"].includes(a.expression.text) &&
            ts.isStringLiteral(b) &&
            b.text === "function"
          )
            return new Set([a.expression.text]);
      }
    }
    return new Set();
  };
  const expression = (n: ts.Node, facts: Set<string>) => {
    if (
      ts.isBinaryExpression(n) &&
      [
        ts.SyntaxKind.AmpersandAmpersandToken,
        ts.SyntaxKind.BarBarToken,
      ].includes(n.operatorToken.kind)
    ) {
      expression(n.left, facts);
      expression(
        n.right,
        plus(
          facts,
          guard(
            n.left,
            n.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken,
          ),
        ),
      );
      return;
    }
    if (
      ts.isCallExpression(n) &&
      ts.isIdentifier(n.expression) &&
      ["ref", "cleanup"].includes(n.expression.text) &&
      !facts.has(n.expression.text)
    )
      typeWarnings.push(
        row(
          n,
          "CALLABLE_GUARD",
          n.expression.text,
          n.getText(file),
          "Call " +
            n.expression.text +
            " only where its callable type is established; an unguarded invocation can fail original native tsc.",
        ),
      );
    ts.forEachChild(n, (child) => expression(child, facts));
  };
  const statement = (
    n: ts.Statement,
    facts: Set<string>,
  ): { facts: Set<string>; fallsThrough: boolean } => {
    if (ts.isBlock(n)) {
      let current = { facts: new Set(facts), fallsThrough: true };
      for (const s of n.statements) {
        if (!current.fallsThrough) break;
        current = statement(s, current.facts);
      }
      return current;
    }
    if (ts.isIfStatement(n)) {
      expression(n.expression, facts);
      const a = statement(
        n.thenStatement,
        plus(facts, guard(n.expression, true)),
      );
      const b = n.elseStatement
        ? statement(n.elseStatement, plus(facts, guard(n.expression, false)))
        : {
            facts: plus(facts, guard(n.expression, false)),
            fallsThrough: true,
          };
      return !a.fallsThrough
        ? b
        : !b.fallsThrough
          ? a
          : { facts: intersect(a.facts, b.facts), fallsThrough: true };
    }
    if (ts.isReturnStatement(n)) {
      if (n.expression) expression(n.expression, facts);
      return { facts, fallsThrough: false };
    }
    expression(n, facts);
    return { facts, fallsThrough: true };
  };
  statement(fn.body, new Set());
  return {
    format: "repolab-preact-body-diagnostics/v2",
    issues: issues.slice(0, 12),
    typeWarnings: typeWarnings.slice(0, 12),
    issueCount: issues.length,
    typeWarningCount: typeWarnings.length,
    diagnosticsTruncated: issues.length > 12 || typeWarnings.length > 12,
    parsed: true,
    authority:
      "advisory only; frozen admission and native lint remain authoritative",
  };
}
export function preactAdmissionFeedback(proposal: unknown, reason: string) {
  let actual: string | null = null;
  try {
    admitPreactEdit(proposal);
  } catch (e) {
    actual = e instanceof Error ? e.message : "Proposal not admitted";
  }
  if (
    (actual !== null && actual !== reason) ||
    (actual === null && reason !== "Unchanged or repeated scoped candidate")
  )
    throw Error("Admission feedback must match the authoritative rejection");
  return {
    kind: "admission",
    reason,
    bodyDiagnostics: preactBodyDiagnostics(
      (proposal as { applyRefBody?: unknown })?.applyRefBody,
    ),
    correction:
      "cleanup must be bound directly from refVNode._refCleanup; result directly from ref(value) inside a callable-ref branch. Do not initialize cleanup to null or assign to cleanup/result afterward. Only the two scoped properties may be assigned. Diagnostics do not grant admission or replace native tests.",
  };
}
export function preactNativeFeedback(
  feedback: unknown,
  proposal: { applyRefBody: unknown },
) {
  const native = z
    .strictObject({
      kind: z.literal("native"),
      stage: z.enum([
        "build",
        "lint",
        "mocha-A",
        "mocha-B",
        "types",
        "browser-A",
        "browser-B",
      ]),
      exitCode: z.number().int().positive(),
      stdout: z.string().max(6000),
      stderr: z.string().max(2000),
    })
    .parse(feedback);
  return {
    ...native,
    bodyDiagnostics: preactBodyDiagnostics(proposal.applyRefBody),
  };
}
export function preactTypeGuidance() {
  const source = preactRepairContext().sourceSlots.applyRef;
  const quote =
    "\t\tif (typeof ref == 'function') ref(value);\n\t\telse ref.current = value;";
  if (!source.includes(quote))
    throw Error("Original callable-ref source quote changed");
  return {
    origin:
      "original Preact applyRef source and unchanged scoped admission policy; no evaluator/reference inputs",
    sourcePath: "src/diff/index.js",
    sourceQuote: quote,
    bindings: [
      {
        name: "cleanup",
        initializer: bindings.cleanup,
        example: "const cleanup = refVNode._refCleanup;",
      },
      {
        name: "result",
        initializer: bindings.result,
        example: "const result = ref(value);",
      },
    ],
    allowedWrites: [...writes],
    allowedCalls: ["ref(value)", "cleanup()"],
    lifecycleResponsibility:
      "Fixed macros transfer cleanup ownership and route replacement/removal/unmount into applyRef. They do not call stored cleanup. The proposed body must invoke stored cleanup when appropriate and preserve legacy callback/object behavior; a returned cleanup replaces the null callback on disposal.",
    cleanupStateType:
      "(() => void) | undefined; the unchanged admission policy supplies this optional per-VNode type",
    rules: [
      "Binding examples are separate grammar examples, not a complete implementation.",
      "Read existing cleanup state with cleanup; do not turn this local into a mutable accumulator for new results.",
      "Store callback results directly in the admitted state property after establishing a callable result.",
      "Use undefined for an empty cleanup state, consistent with the fixed optional callback type.",
      "Declare result only inside a branch that proves typeof ref is function; declaring it before the guard invokes an object ref and can fail original tsc.",
      "Check a stored cleanup callback before calling it. Source assembly supplies the original error-routing try/catch.",
      "Warnings are advisory; unchanged AST admission, native lint/tests and public checks remain required.",
    ],
  };
}
