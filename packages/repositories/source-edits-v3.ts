import { z } from "zod";
import {
  compileSourceEdits as compileStrings,
  sourceEditContext as originalContext,
} from "./source-edits-v2.ts";

const atom = z.strictObject({
  tabs: z.number().int().min(0).max(40),
  spaces: z.number().int().min(0).max(120),
  text: z
    .string()
    .max(2000)
    .refine(
      (s) =>
        !/[\t\r\n]/.test(s) &&
        !s.startsWith(" ") &&
        Buffer.from(s).toString("utf8") === s,
      "Use numeric indentation and one UTF-8 line of text",
    ),
});
type Atom = z.infer<typeof atom>;
export function sourceEditSchema(paths: [string, ...string[]]) {
  return z.strictObject({
    reason: z.string().max(1000),
    edits: z
      .array(
        z.strictObject({
          path: z.enum(paths),
          baseSha256: z.string().regex(/^[a-f0-9]{64}$/),
          expectedMatches: z.number().int().min(1).max(32),
          deleteLines: z.array(atom).min(1).max(200),
          insertLines: z.array(atom).max(200),
        }),
      )
      .min(1)
      .max(32),
  });
}
const emit = (line: Atom) =>
  "\t".repeat(line.tabs) + " ".repeat(line.spaces) + line.text;
export function sourceEditContext(sources: Record<string, string>) {
  return Object.fromEntries(
    Object.entries(originalContext(sources)).map(([path, source]) => [
      path,
      {
        baseSha256: source.baseSha256,
        lineEnding: sources[path].includes("\r\n") ? "\r\n" : "\n",
        finalNewline: sources[path].endsWith("\n"),
        columns: ["tabs", "spaces", "text"],
        lines: source.lines.map((line) => {
          const match = /^(\t*)( *)(.*)$/su.exec(line);
          if (!match) throw Error("Unsupported source indentation");
          const value = atom.parse({
            tabs: match[1].length,
            spaces: match[2].length,
            text: match[3],
          });
          return [value.tabs, value.spaces, value.text];
        }),
      },
    ]),
  );
}
// Explicit encoding for NEW proposals. Previous raw proposals remain untouched.
export function compileSourceEdits(
  original: Record<string, string>,
  value: unknown,
) {
  const proposal = sourceEditSchema(
    Object.keys(original) as [string, ...string[]],
  ).parse(value);
  const decoded = {
    reason: proposal.reason,
    edits: proposal.edits.map((e) => ({
      ...e,
      deleteLines: e.deleteLines.map(emit),
      insertLines: e.insertLines.map(emit),
    })),
  };
  const compiled = compileStrings(original, decoded);
  return { proposal, files: compiled.files };
}
