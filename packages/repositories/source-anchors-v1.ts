import ts from "typescript";
import { z } from "zod";
import { crossSha } from "../execution/cross-repo-sandbox-v1.ts";

export type SourceAnchor = {
  id: string;
  path: string;
  baseSha256: string;
  kind: string;
  text: string;
  ranges: { start: number; end: number }[];
};

/** Static parsing only. No repository module is loaded or evaluated. */
export function sourceAnchors(m: any): SourceAnchor[] {
  const anchors: SourceAnchor[] = [];
  for (const path of [...m.sourcePaths].sort()) {
    if (
      !/^[a-zA-Z0-9_./-]+\.js$/.test(path) ||
      path.startsWith("/") ||
      path.split("/").includes("..")
    )
      throw Error("Closed JavaScript source path required");
    const source = m.sources[path];
    if (
      typeof source !== "string" ||
      Buffer.from(source).toString() !== source ||
      Buffer.byteLength(source) > 120000
    )
      throw Error("Original source byte bounds");
    const baseSha256 = crossSha(source);
    if (m.files[path]?.sha256 !== baseSha256)
      throw Error("Stale original source binding");
    const spans = new Map<
      string,
      { start: number; end: number; kind: string }
    >();
    const add = (start: number, end: number, kind: string) => {
      if (end > start && Buffer.byteLength(source.slice(start, end)) <= 2000)
        spans.set(`${start}:${end}:${kind}`, { start, end, kind });
    };
    const scanner = ts.createScanner(
      ts.ScriptTarget.Latest,
      true,
      ts.LanguageVariant.Standard,
      source,
    );
    for (
      let token = scanner.scan();
      token !== ts.SyntaxKind.EndOfFileToken;
      token = scanner.scan()
    )
      add(
        scanner.getTokenPos(),
        scanner.getTextPos(),
        "token:" + ts.SyntaxKind[token],
      );
    const file = ts.createSourceFile(
      path,
      source,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.JS,
    );
    const visit = (node: ts.Node) => {
      if (
        ts.isBinaryExpression(node) ||
        ts.isCallExpression(node) ||
        ts.isPropertyAccessExpression(node) ||
        ts.isElementAccessExpression(node) ||
        ts.isConditionalExpression(node) ||
        ts.isParenthesizedExpression(node)
      )
        add(
          node.getStart(file),
          node.end,
          "expression:" + ts.SyntaxKind[node.kind],
        );
      ts.forEachChild(node, visit);
    };
    visit(file);
    const groups = new Map<
      string,
      { kind: string; text: string; ranges: { start: number; end: number }[] }
    >();
    const append = (
      kind: string,
      text: string,
      ranges: { start: number; end: number }[],
    ) => {
      const identity = { path, baseSha256, kind, text, ranges };
      anchors.push({
        id: "a_" + crossSha(JSON.stringify(identity)),
        ...identity,
      });
    };
    for (const { start, end, kind } of [...spans.values()].sort(
      (a, b) =>
        a.start - b.start || a.end - b.end || a.kind.localeCompare(b.kind),
    )) {
      const text = source.slice(start, end),
        ranges = [{ start, end }];
      append(kind, text, ranges);
      const key = JSON.stringify([kind, text]);
      if (!groups.has(key)) groups.set(key, { kind, text, ranges: [] });
      groups.get(key)!.ranges.push({ start, end });
    }
    for (const group of groups.values())
      if (group.ranges.length > 1 && group.ranges.length <= 32)
        append("group:" + group.kind, group.text, group.ranges);
  }
  if (
    !anchors.length ||
    anchors.length > 2000 ||
    new Set(anchors.map((a) => a.id)).size !== anchors.length
  )
    throw Error("Source anchor inventory bounds or collision");
  return anchors;
}

export function anchoredPlanSchema(m: any) {
  return z.strictObject({
    reason: z.string().min(1).max(800),
    edits: z
      .array(
        z.strictObject({
          anchorId: z.enum(
            sourceAnchors(m).map((a) => a.id) as [string, ...string[]],
          ),
          replacement: z
            .string()
            .max(2000)
            .refine(
              (s) =>
                Buffer.from(s).toString() === s && Buffer.byteLength(s) <= 2000,
            ),
        }),
      )
      .min(1)
      .max(32),
  });
}

export function compileAnchoredPlan(m: any, value: unknown) {
  const plan = anchoredPlanSchema(m).parse(value),
    catalog = new Map(sourceAnchors(m).map((a) => [a.id, a])),
    changes = new Map<
      string,
      { start: number; end: number; replacement: string }[]
    >();
  for (const edit of plan.edits) {
    const anchor = catalog.get(edit.anchorId)!;
    if (anchor.text === edit.replacement)
      throw Error("Unchanged anchored edit");
    const ranges = changes.get(anchor.path) ?? [];
    for (const range of anchor.ranges)
      ranges.push({ ...range, replacement: edit.replacement });
    changes.set(anchor.path, ranges);
  }
  const files = { ...m.sources } as Record<string, string>;
  for (const [path, ranges] of changes) {
    ranges.sort((a, b) => a.start - b.start || a.end - b.end);
    for (let i = 1; i < ranges.length; i++)
      if (ranges[i].start < ranges[i - 1].end)
        throw Error("Overlapping or duplicate source anchors");
    let source = files[path];
    for (const { start, end, replacement } of ranges.reverse())
      source = source.slice(0, start) + replacement + source.slice(end);
    if (
      Buffer.byteLength(source) > 120000 ||
      Buffer.from(source).toString() !== source
    )
      throw Error("Final source byte bounds");
    files[path] = source;
  }
  return { plan, files };
}
