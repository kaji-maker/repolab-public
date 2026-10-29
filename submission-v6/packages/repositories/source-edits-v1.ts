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
          startLine: z.number().int().min(1).max(10000),
          deleteLines: z.array(line).max(200),
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
        lines: splitSource(source).lines.map((text, i) => ({
          line: i + 1,
          text,
        })),
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
    const edits = proposal.edits
      .filter((e) => e.path === path)
      .sort((a, b) => a.startLine - b.startLine);
    if (!edits.length) continue;
    const base = original[path],
      { lines, eol, finalNewline } = splitSource(base),
      output: string[] = [];
    let cursor = 0,
      lastStart = -1;
    for (const edit of edits) {
      const start = edit.startLine - 1,
        end = start + edit.deleteLines.length;
      if (edit.baseSha256 !== sha(base)) throw Error("Stale source hash");
      if (
        start < cursor ||
        start === lastStart ||
        start > lines.length ||
        end > lines.length
      )
        throw Error("Overlapping or out-of-range edit");
      if (
        JSON.stringify(lines.slice(start, end)) !==
        JSON.stringify(edit.deleteLines)
      )
        throw Error("Source lines do not match pinned original");
      if (JSON.stringify(edit.deleteLines) === JSON.stringify(edit.insertLines))
        throw Error("Empty edit");
      output.push(...lines.slice(cursor, start), ...edit.insertLines);
      cursor = end;
      lastStart = start;
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
