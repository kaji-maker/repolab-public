import { z } from "zod";
import { createHash } from "node:crypto";

const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const line = z
  .string()
  .max(2000)
  .refine(
    (s) => !/[\r\n]/.test(s) && Buffer.from(s).toString("utf8") === s,
    "Expected one UTF-8 logical line",
  );
export function sourceEditSchema(paths: [string, ...string[]]) {
  return z.strictObject({
    reason: z.string().max(1000),
    edits: z
      .array(
        z.strictObject({
          path: z.enum(paths),
          baseSha256: z.string().regex(/^[a-f0-9]{64}$/),
          expectedMatches: z.number().int().min(1).max(32),
          deleteLines: z.array(line).min(1).max(200),
          insertLines: z.array(line).max(200),
        }),
      )
      .min(1)
      .max(32),
  });
}

function splitSource(source: string) {
  if (Buffer.from(source).toString("utf8") !== source)
    throw Error("Invalid UTF-8 source");
  const eol = source.includes("\r\n") ? "\r\n" : "\n";
  if (/[\r\n]/.test(source.split(eol).join("")))
    throw Error("Mixed or unsupported line endings");
  const finalNewline = source.endsWith(eol);
  const lines = source.split(eol);
  if (finalNewline) lines.pop();
  return { lines, eol, finalNewline };
}

// Pure data transformation: never imports, parses as code, or executes candidate source.
export function sourceEditContext(sources: Record<string, string>) {
  return Object.fromEntries(
    Object.entries(sources).map(([path, source]) => [
      path,
      {
        baseSha256: sha(source),
        lines: splitSource(source).lines,
      },
    ]),
  );
}

export function compileSourceEdits(
  original: Record<string, string>,
  value: unknown,
) {
  const paths = Object.keys(original);
  if (!paths.length) throw Error("No editable source paths");
  const proposal = sourceEditSchema(paths as [string, ...string[]]).parse(
    value,
  );
  const files = { ...original };
  for (const path of paths) {
    const edits = proposal.edits.filter((e) => e.path === path);
    if (!edits.length) continue;
    const base = original[path],
      { lines, eol, finalNewline } = splitSource(base),
      output: string[] = [];
    const splices: { start: number; end: number; insert: string[] }[] = [];
    for (const edit of edits) {
      if (edit.baseSha256 !== sha(base)) throw Error("Stale source hash");
      if (JSON.stringify(edit.deleteLines) === JSON.stringify(edit.insertLines))
        throw Error("Empty edit");
      const matches: number[] = [];
      for (
        let start = 0;
        start + edit.deleteLines.length <= lines.length;
        start++
      ) {
        if (edit.deleteLines.every((text, i) => text === lines[start + i]))
          matches.push(start);
      }
      if (matches.length !== edit.expectedMatches)
        throw Error(
          "Exact source block matched " +
            matches.length +
            " times; expected " +
            edit.expectedMatches +
            ". Use more unchanged context or the exact intended match count.",
        );
      for (const start of matches)
        splices.push({
          start,
          end: start + edit.deleteLines.length,
          insert: edit.insertLines,
        });
    }
    splices.sort((a, b) => a.start - b.start);
    let cursor = 0;
    for (const splice of splices) {
      if (splice.start < cursor) throw Error("Overlapping source blocks");
      output.push(...lines.slice(cursor, splice.start), ...splice.insert);
      cursor = splice.end;
    }
    output.push(...lines.slice(cursor));
    files[path] = output.join(eol) + (finalNewline && output.length ? eol : "");
    if (!files[path].length || Buffer.byteLength(files[path]) > 16000)
      throw Error("Candidate source size out of bounds");
  }
  if (paths.every((p) => files[p] === original[p]))
    throw Error("Unchanged candidate");
  return { proposal, files };
}
