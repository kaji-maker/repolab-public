import ts from "typescript";

/** A deliberately narrow pure-JavaScript subset for this development pilot.
 * Parsing never imports or evaluates candidate bytes. This supplements remote
 * isolation and prevents candidates from reaching the TAP/observation machinery.
 */
export function checkCandidateSource(source: string) {
  const fail = () => {
    throw Error("Candidate must use the admitted pure clsx syntax subset");
  };
  if (Buffer.byteLength(source) > 16000) fail();
  const file = ts.createSourceFile(
    "index.js",
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.JS,
  );
  if (
    (file as ts.SourceFile & { parseDiagnostics: unknown[] }).parseDiagnostics
      .length
  )
    fail();
  const functions = file.statements;
  if (
    functions.length < 1 ||
    functions.length > 3 ||
    functions.some((f) => !ts.isFunctionDeclaration(f))
  )
    fail();
  const names = new Set<string>();
  let defaults = 0;
  for (const f of functions as unknown as ts.FunctionDeclaration[]) {
    if (!f.body || f.asteriskToken || f.type || f.typeParameters) fail();
    const modifiers = f.modifiers?.map((m) => m.kind) ?? [];
    if (modifiers.length) {
      if (
        modifiers.length !== 2 ||
        !modifiers.includes(ts.SyntaxKind.ExportKeyword) ||
        !modifiers.includes(ts.SyntaxKind.DefaultKeyword)
      )
        fail();
      defaults++;
    }
    if (f.name) {
      if (
        names.has(f.name.text) ||
        ["Array", "arguments", "undefined"].includes(f.name.text)
      )
        fail();
      names.add(f.name.text);
    } else if (!modifiers.length) fail();
  }
  if (defaults !== 1) fail();
  for (const f of functions as unknown as ts.FunctionDeclaration[]) {
    const locals = new Set<string>();
    const declare = (n: ts.Node) => {
      if (
        !ts.isIdentifier(n) ||
        names.has(n.text) ||
        ["Array", "arguments", "undefined"].includes(n.text)
      )
        fail();
      locals.add((n as ts.Identifier).text);
    };
    for (const p of f.parameters) {
      if (
        p.dotDotDotToken ||
        p.initializer ||
        p.type ||
        p.modifiers ||
        p.questionToken
      )
        fail();
      declare(p.name);
    }
    const declarations = (n: ts.Node) => {
      if (ts.isVariableDeclaration(n)) {
        if (n.type || n.exclamationToken) fail();
        declare(n.name);
      }
      ts.forEachChild(n, declarations);
    };
    declarations(f.body!);
    const localTarget = (n: ts.Node) => {
      if (!ts.isIdentifier(n) || !locals.has(n.text)) fail();
    };
    const expr = (n: ts.Node): void => {
      if (ts.isIdentifier(n)) {
        if (
          !locals.has(n.text) &&
          !names.has(n.text) &&
          !["arguments", "undefined"].includes(n.text)
        )
          fail();
        return;
      }
      if (
        ts.isStringLiteral(n) ||
        ts.isNumericLiteral(n) ||
        [
          ts.SyntaxKind.TrueKeyword,
          ts.SyntaxKind.FalseKeyword,
          ts.SyntaxKind.NullKeyword,
        ].includes(n.kind)
      )
        return;
      if (
        ts.isParenthesizedExpression(n) ||
        ts.isTypeOfExpression(n) ||
        ts.isVoidExpression(n)
      ) {
        expr(n.expression);
        return;
      }
      if (ts.isBinaryExpression(n)) {
        const op = n.operatorToken.kind;
        if (
          op >= ts.SyntaxKind.FirstAssignment &&
          op <= ts.SyntaxKind.LastAssignment
        )
          localTarget(n.left);
        expr(n.left);
        expr(n.right);
        return;
      }
      if (ts.isPrefixUnaryExpression(n) || ts.isPostfixUnaryExpression(n)) {
        if (
          n.operator === ts.SyntaxKind.PlusPlusToken ||
          n.operator === ts.SyntaxKind.MinusMinusToken
        )
          localTarget(n.operand);
        expr(n.operand);
        return;
      }
      if (ts.isConditionalExpression(n)) {
        expr(n.condition);
        expr(n.whenTrue);
        expr(n.whenFalse);
        return;
      }
      if (ts.isPropertyAccessExpression(n)) {
        if (
          ts.isIdentifier(n.expression) &&
          n.expression.text === "Array" &&
          n.name.text === "isArray"
        )
          return;
        if (!["length", "push", "call"].includes(n.name.text)) fail();
        expr(n.expression);
        return;
      }
      if (ts.isElementAccessExpression(n)) {
        expr(n.expression);
        if (!n.argumentExpression) fail();
        expr(n.argumentExpression!);
        return;
      }
      if (ts.isCallExpression(n)) {
        if (n.typeArguments || n.questionDotToken) fail();
        const target = n.expression;
        const pureCall = ts.isIdentifier(target) && names.has(target.text);
        const arrayCheck =
          ts.isPropertyAccessExpression(target) &&
          ts.isIdentifier(target.expression) &&
          target.expression.text === "Array" &&
          target.name.text === "isArray" &&
          n.arguments.length === 1;
        if (!pureCall && !arrayCheck) fail();
        n.arguments.forEach(expr);
        return;
      }
      fail();
    };
    const variables = (list: ts.VariableDeclarationList) => {
      for (const d of list.declarations) if (d.initializer) expr(d.initializer);
    };
    const statement = (n: ts.Statement): void => {
      if (ts.isBlock(n)) {
        n.statements.forEach(statement);
        return;
      }
      if (ts.isVariableStatement(n)) {
        if (n.modifiers) fail();
        variables(n.declarationList);
        return;
      }
      if (ts.isExpressionStatement(n)) {
        expr(n.expression);
        return;
      }
      if (ts.isReturnStatement(n)) {
        if (n.expression) expr(n.expression);
        return;
      }
      if (ts.isIfStatement(n)) {
        expr(n.expression);
        statement(n.thenStatement);
        if (n.elseStatement) statement(n.elseStatement);
        return;
      }
      if (ts.isWhileStatement(n) || ts.isDoStatement(n)) {
        expr(n.expression);
        statement(n.statement);
        return;
      }
      if (ts.isForStatement(n)) {
        if (n.initializer)
          ts.isVariableDeclarationList(n.initializer)
            ? variables(n.initializer)
            : expr(n.initializer);
        if (n.condition) expr(n.condition);
        if (n.incrementor) expr(n.incrementor);
        statement(n.statement);
        return;
      }
      if (ts.isForInStatement(n)) {
        if (ts.isVariableDeclarationList(n.initializer))
          variables(n.initializer);
        else localTarget(n.initializer);
        expr(n.expression);
        statement(n.statement);
        return;
      }
      if (
        ts.isEmptyStatement(n) ||
        ((ts.isBreakStatement(n) || ts.isContinueStatement(n)) && !n.label)
      )
        return;
      fail();
    };
    statement(f.body!);
  }
  return {
    name: "Candidate pure-source admission",
    passed: true,
    detail:
      "Parsed bounded pure functions; no imports, global access, member writes or ambient calls",
  };
}
