import { readFileSync } from "node:fs";
import ts from "typescript";
import { z } from "zod";
import {
  shaNative,
  auditNativeFreeze,
} from "../evaluation/preact-native-v5.ts";

const Proposal = z
  .object({
    taskId: z.literal("preactjs__preact-4436"),
    applyRefBody: z.string().min(1).max(1800),
    refUpdates: z.enum(["original", "transfer-cleanup"]),
    unmountContext: z.enum(["original", "vnode"]),
    cleanupType: z.literal(true),
  })
  .strict();
export type PreactEdit = z.infer<typeof Proposal>;
export const preactOriginalPaths = {
  "src/diff/index.js": "diff-index.js",
  "src/diff/children.js": "diff-children.js",
  "src/internal.d.ts": "internal.d.ts",
};
export function preactOriginalSources() {
  const m = JSON.parse(
    readFileSync("fixtures/preact-native/original-manifest.json", "utf8"),
  );
  return Object.fromEntries(
    Object.entries(preactOriginalPaths).map(([path, name]) => {
      const bytes = readFileSync(
        "repositories/preact-admission-v1/original/" + name,
      );
      if (
        shaNative(bytes) !==
        m.files.find((f: { path: string }) => f.path === path)?.sha256
      )
        throw Error("Original Preact slot source changed");
      return [path, bytes.toString("utf8")];
    }),
  );
}
function permittedBody(body: string) {
  const scanner = ts.createScanner(
    ts.ScriptTarget.ES2023,
    false,
    ts.LanguageVariant.Standard,
    body,
  );
  for (
    let k = scanner.scan();
    k !== ts.SyntaxKind.EndOfFileToken;
    k = scanner.scan()
  )
    if (
      [
        ts.SyntaxKind.SingleLineCommentTrivia,
        ts.SyntaxKind.MultiLineCommentTrivia,
      ].includes(k)
    )
      throw Error("Comments cannot enter admitted ref body");
  const file = ts.createSourceFile(
    "proposal.js",
    "function admitted(ref,value,vnode,refVNode){" + body + "}",
    ts.ScriptTarget.ES2023,
    true,
    ts.ScriptKind.JS,
  );
  if (
    (file as ts.SourceFile & { parseDiagnostics: unknown[] }).parseDiagnostics
      .length ||
    file.statements.length !== 1 ||
    !ts.isFunctionDeclaration(file.statements[0]) ||
    !file.statements[0].body
  )
    throw Error("Invalid ref body syntax");
  const locals = new Set(["ref", "value", "vnode", "refVNode"]);
  const properties = new Set(["refVNode._refCleanup", "ref.current"]);
  let nodes = 0;
  const allowed = new Set([
    ts.SyntaxKind.Block,
    ts.SyntaxKind.IfStatement,
    ts.SyntaxKind.ReturnStatement,
    ts.SyntaxKind.VariableStatement,
    ts.SyntaxKind.VariableDeclarationList,
    ts.SyntaxKind.VariableDeclaration,
    ts.SyntaxKind.ExpressionStatement,
    ts.SyntaxKind.BinaryExpression,
    ts.SyntaxKind.PrefixUnaryExpression,
    ts.SyntaxKind.ParenthesizedExpression,
    ts.SyntaxKind.TypeOfExpression,
    ts.SyntaxKind.PropertyAccessExpression,
    ts.SyntaxKind.CallExpression,
    ts.SyntaxKind.Identifier,
    ts.SyntaxKind.StringLiteral,
    ts.SyntaxKind.NullKeyword,
    ts.SyntaxKind.EqualsToken,
    ts.SyntaxKind.EqualsEqualsToken,
    ts.SyntaxKind.EqualsEqualsEqualsToken,
    ts.SyntaxKind.ExclamationEqualsToken,
    ts.SyntaxKind.ExclamationEqualsEqualsToken,
    ts.SyntaxKind.AmpersandAmpersandToken,
    ts.SyntaxKind.BarBarToken,
    ts.SyntaxKind.ExclamationToken,
  ]);
  const visit = (n: ts.Node) => {
    if (++nodes > 160 || !allowed.has(n.kind))
      throw Error("Ref body operation not admitted");
    if (
      ts.isPrefixUnaryExpression(n) &&
      n.operator !== ts.SyntaxKind.ExclamationToken
    )
      throw Error("Ref unary mutation not admitted");
    if (ts.isVariableDeclaration(n)) {
      if (
        !ts.isIdentifier(n.name) ||
        !["cleanup", "result"].includes(n.name.text) ||
        locals.has(n.name.text) ||
        !n.initializer
      )
        throw Error("Ref local binding not admitted");
      const init = n.initializer.getText(file);
      if (
        (n.name.text === "cleanup" && init !== "refVNode._refCleanup") ||
        (n.name.text === "result" && !/^ref\(\s*value\s*\)$/.test(init))
      )
        throw Error("Ref binding origin changed");
      locals.add(n.name.text);
    }
    if (ts.isIdentifier(n)) {
      if (ts.isPropertyAccessExpression(n.parent) && n.parent.name === n)
        return;
      if (n.text !== "undefined" && !locals.has(n.text))
        throw Error("Ambient identifier not admitted");
    }
    if (ts.isStringLiteral(n) && n.text !== "function")
      throw Error("Ref literal not admitted");
    if (ts.isPropertyAccessExpression(n) && !properties.has(n.getText(file)))
      throw Error("Ref property not admitted");
    if (
      ts.isCallExpression(n) &&
      !(
        ts.isIdentifier(n.expression) &&
        ((n.expression.text === "ref" &&
          n.arguments.length === 1 &&
          n.arguments[0].getText(file) === "value") ||
          (n.expression.text === "cleanup" &&
            locals.has("cleanup") &&
            n.arguments.length === 0))
      )
    )
      throw Error("Ref call not admitted");
    if (
      ts.isBinaryExpression(n) &&
      n.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      !properties.has(n.left.getText(file))
    )
      throw Error("Ref mutation not admitted");
    ts.forEachChild(n, visit);
  };
  visit(file.statements[0].body);
}
function replaceOne(source: string, before: string, after: string) {
  if (source.split(before).length !== 2)
    throw Error("Original source slot ambiguous");
  return source.replace(before, after);
}
export const oldRefBlock =
  "\t\tif (childVNode.ref && oldVNode.ref != childVNode.ref) {\n\t\t\tif (oldVNode.ref) {\n\t\t\t\tapplyRef(oldVNode.ref, null, childVNode);\n\t\t\t}\n\t\t\trefQueue.push(\n\t\t\t\tchildVNode.ref,\n\t\t\t\tchildVNode._component || newDom,\n\t\t\t\tchildVNode\n\t\t\t);\n\t\t}";
const newRefBlock =
  "\t\tif ((childVNode.ref || oldVNode._refCleanup) && oldVNode.ref != childVNode.ref) {\n\t\t\tif (oldVNode.ref) applyRef(oldVNode.ref, null, childVNode, oldVNode);\n\t\t\tif (childVNode.ref) refQueue.push(childVNode.ref, childVNode._component || newDom, childVNode);\n\t\t} else if (childVNode.ref && oldVNode !== childVNode) {\n\t\t\tchildVNode._refCleanup = oldVNode._refCleanup;\n\t\t\toldVNode._refCleanup = undefined;\n\t\t}";
export function admitPreactEdit(value: unknown) {
  const proposal = Proposal.parse(value);
  permittedBody(proposal.applyRefBody);
  const original = preactOriginalSources();
  const files = { ...original };
  files["src/diff/index.js"] = replaceOne(
    files["src/diff/index.js"],
    "export function applyRef(ref, value, vnode) {",
    "export function applyRef(ref, value, vnode, refVNode = vnode) {",
  );
  files["src/diff/index.js"] = replaceOne(
    files["src/diff/index.js"],
    "\t\tif (typeof ref == 'function') ref(value);\n\t\telse ref.current = value;",
    proposal.applyRefBody
      .trim()
      .split("\n")
      .map((l) => "\t\t" + l)
      .join("\n"),
  );
  if (proposal.unmountContext === "vnode")
    files["src/diff/index.js"] = replaceOne(
      files["src/diff/index.js"],
      "applyRef(r, null, parentVNode);",
      "applyRef(r, null, parentVNode, vnode);",
    );
  if (proposal.refUpdates === "transfer-cleanup")
    files["src/diff/children.js"] = replaceOne(
      files["src/diff/children.js"],
      oldRefBlock,
      newRefBlock,
    );
  files["src/internal.d.ts"] = replaceOne(
    files["src/internal.d.ts"],
    "\t\tref?: Ref<any> | null;",
    "\t\tref?: Ref<any> | null;\n\t\t_refCleanup?: (() => void) | undefined;",
  );
  const sourceHash = shaNative(
    JSON.stringify(
      Object.entries(files).map(([path, text]) => ({
        path,
        sha256: shaNative(text),
      })),
    ),
  );
  return {
    proposal,
    files,
    sourceHash,
    origin: "scoped source assembly only; never executed on controller",
  };
}
export function preactRepairContext() {
  auditNativeFreeze();
  const selected = JSON.parse(
    readFileSync("evaluation/external-selected-v1.json", "utf8"),
  );
  const task = selected.selected.find(
    (t: { instance_id: string }) => t.instance_id === "preactjs__preact-4436",
  );
  if (!task) throw Error("Selected Preact report missing");
  const sources = preactOriginalSources();
  // Original report and permitted source slots only; no fixtures or evaluation assets.
  return {
    taskId: task.instance_id,
    repo: task.repo,
    baseCommit: task.base_commit,
    problemStatement: task.problem_statement,
    allowedEdit: {
      applyRefBody: "callback-ref handling inside existing try/catch",
      refUpdates: ["original", "transfer-cleanup"],
      unmountContext: ["original", "vnode"],
      cleanupType: true,
      properties: ["refVNode._refCleanup", "ref.current"],
      parameters: ["ref", "value", "vnode", "refVNode"],
      locals: ["cleanup", "result"],
      bindings: { cleanup: "refVNode._refCleanup", result: "ref(value)" },
      calls: ["ref(value)", "cleanup()"],
      statements: ["if", "return", "const/let", "assignment"],
      strings: ["function"],
    },
    sourceSlots: {
      applyRef: sources["src/diff/index.js"].slice(
        sources["src/diff/index.js"].indexOf("export function applyRef"),
      ),
      refUpdates: oldRefBlock,
      cleanupType: "optional per-VNode cleanup callback",
    },
  };
}
