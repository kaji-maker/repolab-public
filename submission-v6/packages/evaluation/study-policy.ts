import ts from "typescript";
import { checkCandidateSource } from "../repositories/candidate-policy.ts";
import type { StudyTaskId } from "./study-tasks.ts";
/** Static parsing only. Same source safety admission in every arm. */
export function checkStudySource(id: StudyTaskId, source: string) {
  if (id === "clsx-object-push") return checkCandidateSource(source);
  const fail = () => {
    throw Error("Source is outside the reviewed pure study subset");
  };
  if (Buffer.byteLength(source) > 16000) fail();
  const file = ts.createSourceFile(
    "candidate.mjs",
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.JS,
  );
  if ((file as any).parseDiagnostics.length) fail();
  const main = id === "booking-timezone" ? "bookingDate" : "checkoutTotal";
  if (
    file.statements.length < 1 ||
    file.statements.length > 3 ||
    file.statements.some((n) => !ts.isFunctionDeclaration(n))
  )
    fail();
  const declarations = new Set<string>(["undefined"]),
    callables = new Set<string>(),
    methods = new Set([
      "parse",
      "toISOString",
      "slice",
      "formatToParts",
      "format",
      "find",
      "map",
      "join",
      "split",
      "padStart",
      "toLocaleDateString",
    ]),
    properties = new Set([...methods, "type", "value", "length"]);
  let exports = 0;
  const declare = (name: ts.Node) => {
    if (
      !ts.isIdentifier(name) ||
      ["Date", "Intl", "Array", "undefined"].includes(name.text)
    )
      fail();
    declarations.add((name as ts.Identifier).text);
  };
  const collect = (n: ts.Node) => {
    if (ts.isFunctionDeclaration(n)) {
      if (n.name) {
        declare(n.name);
        callables.add(n.name.text);
      }
      if (n.modifiers?.length) {
        if (
          n.modifiers.length !== 1 ||
          n.modifiers[0].kind !== ts.SyntaxKind.ExportKeyword ||
          n.name?.text !== main
        )
          fail();
        exports++;
      }
    }
    if (ts.isParameter(n) || ts.isVariableDeclaration(n)) declare(n.name);
    if (
      ts.isVariableDeclaration(n) &&
      n.initializer &&
      (ts.isArrowFunction(n.initializer) ||
        ts.isFunctionExpression(n.initializer)) &&
      ts.isIdentifier(n.name)
    )
      callables.add(n.name.text);
    ts.forEachChild(n, collect);
  };
  collect(file);
  if (exports !== 1) fail();
  const denied = new Set([
    ts.SyntaxKind.ImportDeclaration,
    ts.SyntaxKind.ImportKeyword,
    ts.SyntaxKind.ExportAssignment,
    ts.SyntaxKind.ClassDeclaration,
    ts.SyntaxKind.MethodDeclaration,
    ts.SyntaxKind.GetAccessor,
    ts.SyntaxKind.SetAccessor,
    ts.SyntaxKind.ThrowStatement,
    ts.SyntaxKind.TryStatement,
    ts.SyntaxKind.ThisKeyword,
    ts.SyntaxKind.SuperKeyword,
    ts.SyntaxKind.AwaitExpression,
    ts.SyntaxKind.YieldExpression,
    ts.SyntaxKind.DeleteExpression,
    ts.SyntaxKind.TaggedTemplateExpression,
    ts.SyntaxKind.SpreadAssignment,
    ts.SyntaxKind.SpreadElement,
    ts.SyntaxKind.ForInStatement,
  ]);
  const visit = (n: ts.Node) => {
    if (denied.has(n.kind)) fail();
    if (ts.isIdentifier(n)) {
      const parent = n.parent;
      const key =
        (ts.isPropertyAccessExpression(parent) && parent.name === n) ||
        (ts.isPropertyAssignment(parent) && parent.name === n);
      if (
        !key &&
        !declarations.has(n.text) &&
        !["Date", "Intl"].includes(n.text)
      )
        fail();
    }
    if (ts.isPropertyAccessExpression(n)) {
      const constructor =
        ts.isIdentifier(n.expression) &&
        n.expression.text === "Intl" &&
        n.name.text === "DateTimeFormat";
      if (!constructor && !properties.has(n.name.text)) fail();
    }
    if (ts.isCallExpression(n)) {
      if (n.questionDotToken) fail();
      if (ts.isIdentifier(n.expression)) {
        if (!callables.has(n.expression.text)) fail();
      } else if (
        !ts.isPropertyAccessExpression(n.expression) ||
        !methods.has(n.expression.name.text)
      )
        fail();
    }
    if (ts.isNewExpression(n)) {
      const target = n.expression.getText(file);
      if (!["Date", "Intl.DateTimeFormat"].includes(target)) fail();
    }
    if (
      ts.isBinaryExpression(n) &&
      n.operatorToken.kind >= ts.SyntaxKind.FirstAssignment &&
      n.operatorToken.kind <= ts.SyntaxKind.LastAssignment
    ) {
      if (!ts.isIdentifier(n.left) || !declarations.has(n.left.text)) fail();
    }
    if (
      (ts.isPrefixUnaryExpression(n) || ts.isPostfixUnaryExpression(n)) &&
      [ts.SyntaxKind.PlusPlusToken, ts.SyntaxKind.MinusMinusToken].includes(
        n.operator,
      )
    ) {
      if (!ts.isIdentifier(n.operand)) fail();
    }
    if (
      ts.isElementAccessExpression(n) &&
      (!n.argumentExpression || !ts.isNumericLiteral(n.argumentExpression))
    )
      fail();
    if (
      (ts.isFunctionDeclaration(n) ||
        ts.isArrowFunction(n) ||
        ts.isFunctionExpression(n)) &&
      ((n as any).asteriskToken ||
        n.modifiers?.some((m) => m.kind === ts.SyntaxKind.AsyncKeyword))
    )
      fail();
    ts.forEachChild(n, visit);
  };
  visit(file);
  return {
    name: "Common pure-source safety",
    passed: true,
    detail:
      "Static bounded source admission, with no imports, ambient I/O, prototypes or member writes",
  };
}
