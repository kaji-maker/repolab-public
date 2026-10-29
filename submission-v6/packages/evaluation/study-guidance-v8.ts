import ts from "typescript";
import { commonTask } from "./study-adapters-v6.ts";
import type { CommonTask } from "./study-adapters-v6.ts";
import { commonRepairContext, commonRepairSystem } from "./study-policy-v5.ts";
import { focusedPublicFeedback } from "./study-feedback-v7.ts";
import { sha256 } from "../evidence/hash.ts";

/** Source-bound guidance, not an expanded source-admission policy or reference answer. */
export function typeAwareRepairContext(
  task: string,
  source: string,
  path: string,
) {
  const context = commonRepairContext(task, source, path);
  if (task !== "mri-zero-number") return context;
  const original = commonTask(task);
  if (source !== original.source || path !== original.path)
    throw Error("Type guidance source identity changed");
  const file = ts.createSourceFile(
    "original.js",
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.JS,
  );
  const names = ["isBool", "toNum", "typecast"];
  const sourceQuotes = file.statements
    .filter(
      (s): s is ts.FunctionDeclaration =>
        ts.isFunctionDeclaration(s) && names.includes(s.name?.text ?? ""),
    )
    .map((s) => s.getText(file));
  const booleanQuotes: string[] = [];
  const visit = (node: ts.Node) => {
    if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      ts.isIdentifier(node.left) &&
      node.left.text === "tmp" &&
      ts.isBinaryExpression(node.right) &&
      node.right.operatorToken.kind === ts.SyntaxKind.BarBarToken &&
      node.right.right.kind === ts.SyntaxKind.TrueKeyword
    )
      booleanQuotes.push(node.getText(file));
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === "typecast" &&
      node.arguments[1]?.kind === ts.SyntaxKind.TrueKeyword
    )
      booleanQuotes.push(node.getText(file));
    ts.forEachChild(node, visit);
  };
  visit(file);
  if (sourceQuotes.length !== 3 || booleanQuotes.length !== 2)
    throw Error("Type guidance source evidence missing");
  return {
    ...context,
    scalarTypeFacts: {
      format: "repolab-source-type-guidance/v8",
      sourceHash: sha256(source),
      parameter: "any",
      helper: "toNum",
      observedSourceDomains: ["string", "boolean"],
      sourceQuotes: [...sourceQuotes, ...booleanQuotes],
      scope:
        "These source facts show strings and boolean flags can reach the helper; they do not prove a complete JavaScript type domain.",
      requirements: [
        "Preserve boolean flag values and original non-string behavior.",
        "Call a string method only on a branch where typeof establishes a string receiver. JavaScript short-circuit and conditional evaluation order matter.",
        "Distinguish blank strings from numeric strings using supplied public expectations. Retain the original value when a blank string must be preserved.",
        "Retain string-option handling, numeric zero behavior and all original tests. Type guidance cannot authorize broader edits or new expected outputs.",
      ],
    },
  };
}
export function typeAwareRepairSystem(task: string) {
  return (
    commonRepairSystem(task) +
    (task === "mri-zero-number"
      ? " Read scalarTypeFacts before proposing. The numeric helper is also called with boolean flags. Establish a string receiver before a string-method call, and preserve other inputs. This guidance supplies no new expected behavior or permission to change tests."
      : "")
  );
}

type Domain = Set<"string" | "other">;
const unwrap = (n: ts.Expression): ts.Expression =>
  ts.isParenthesizedExpression(n) ? unwrap(n.expression) : n;
const union = (a: Domain, b: Domain): Domain => new Set([...a, ...b]);
function refine(
  expression: ts.Expression,
  truth: boolean,
  domain: Domain,
): Domain {
  const n = unwrap(expression);
  if (
    ts.isPrefixUnaryExpression(n) &&
    n.operator === ts.SyntaxKind.ExclamationToken
  )
    return refine(n.operand, !truth, domain);
  if (!ts.isBinaryExpression(n)) return domain;
  const op = n.operatorToken.kind;
  if (op === ts.SyntaxKind.AmpersandAmpersandToken)
    return truth
      ? refine(n.right, true, refine(n.left, true, domain))
      : union(
          refine(n.left, false, domain),
          refine(n.right, false, refine(n.left, true, domain)),
        );
  if (op === ts.SyntaxKind.BarBarToken)
    return truth
      ? union(
          refine(n.left, true, domain),
          refine(n.right, true, refine(n.left, false, domain)),
        )
      : refine(n.right, false, refine(n.left, false, domain));
  const left = unwrap(n.left),
    right = unwrap(n.right);
  const typeOfAny = (x: ts.Expression) =>
    ts.isTypeOfExpression(x) &&
    ts.isIdentifier(unwrap(x.expression)) &&
    (unwrap(x.expression) as ts.Identifier).text === "any";
  const stringType = (x: ts.Expression) =>
    ts.isStringLiteral(x) && x.text === "string";
  if (!(
    (typeOfAny(left) && stringType(right)) ||
    (stringType(left) && typeOfAny(right))
  ))
    return domain;
  const equal = [
    ts.SyntaxKind.EqualsEqualsToken,
    ts.SyntaxKind.EqualsEqualsEqualsToken,
  ].includes(op);
  const unequal = [
    ts.SyntaxKind.ExclamationEqualsToken,
    ts.SyntaxKind.ExclamationEqualsEqualsToken,
  ].includes(op);
  if (!equal && !unequal) return domain;
  const kind = truth === equal ? "string" : "other";
  return new Set([...domain].filter((t) => t === kind));
}
/** Parse and conservatively inspect evaluation paths; never evaluate candidate code. */
export function typeDiagnostics(task: string, expression: string) {
  if (task !== "mri-zero-number") return [];
  const file = ts.createSourceFile(
    "expression.js",
    "const value=(" + expression + ");",
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.JS,
  );
  const statement = file.statements[0];
  if (
    (file as any).parseDiagnostics.length ||
    file.statements.length !== 1 ||
    !ts.isVariableStatement(statement)
  )
    throw Error("Type diagnostic expression parse failed");
  const root = statement.declarationList.declarations[0].initializer;
  if (!root) throw Error("Type diagnostic expression missing");
  const diagnostics: any[] = [];
  const visit = (node: ts.Node, domain: Domain) => {
    if (!domain.size) return;
    if (ts.isConditionalExpression(node)) {
      visit(node.condition, domain);
      visit(node.whenTrue, refine(node.condition, true, domain));
      visit(node.whenFalse, refine(node.condition, false, domain));
      return;
    }
    if (
      ts.isBinaryExpression(node) &&
      [
        ts.SyntaxKind.AmpersandAmpersandToken,
        ts.SyntaxKind.BarBarToken,
      ].includes(node.operatorToken.kind)
    ) {
      visit(node.left, domain);
      visit(
        node.right,
        refine(
          node.left,
          node.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken,
          domain,
        ),
      );
      return;
    }
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      ts.isIdentifier(node.expression.expression) &&
      node.expression.expression.text === "any" &&
      node.expression.name.text === "trim" &&
      domain.has("other")
    )
      diagnostics.push({
        code: "STRING_RECEIVER_UNPROVEN",
        method: "trim",
        requiredType: "string",
        message:
          "A reachable any.trim() call lacks a proven string receiver. The original helper can receive boolean flags. Guard the receiver using typeof and preserve non-string values. This conservative warning does not change admission or predict test results.",
      });
    ts.forEachChild(node, (child) => visit(child, domain));
  };
  visit(root, new Set(["string", "other"]));
  return diagnostics;
}
export function typeAwareCandidateFeedback(
  task: CommonTask,
  proposal: any,
  gates: any[],
) {
  return {
    ...focusedPublicFeedback(task, gates),
    typeDiagnostics: typeDiagnostics(task.id, proposal.after),
  };
}
