import { z } from "zod";
import { createHash } from "node:crypto";
const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const utf8 = (s: string) => Buffer.from(s).toString("utf8") === s;
export function literalIntentSchema(paths: [string, ...string[]]) {
  return z.strictObject({
    format: z.literal("repolab-literal-intent/v1"),
    edits: z
      .array(
        z.strictObject({
          path: z.enum(paths),
          baseSha256: z.string().regex(/^[a-f0-9]{64}$/),
          find: z.string().min(1).max(2000).refine(utf8),
          replace: z.string().max(2000).refine(utf8),
          expectedMatches: z.number().int().min(1).max(32),
        }),
      )
      .min(1)
      .max(32),
  });
}
/** Compile validated literal intent against ORIGINAL bytes. No model, regex, eval or file execution. */
export function compileLiteralIntent(
  original: Record<string, string>,
  value: unknown,
) {
  const paths = Object.keys(original) as [string, ...string[]];
  if (
    !paths.length ||
    paths.some(
      (p) =>
        !p ||
        p.startsWith("/") ||
        !/^[a-zA-Z0-9_./-]+$/.test(p) ||
        p.split("/").includes(".."),
    )
  )
    throw Error("Invalid closed source paths");
  for (const s of Object.values(original))
    if (!utf8(s) || Buffer.byteLength(s) > 120000)
      throw Error("Invalid original source bytes");
  const intent = literalIntentSchema(paths).parse(value),
    spans: Record<
      string,
      { start: number; end: number; replacement: string }[]
    > = {};
  for (const edit of intent.edits) {
    const source = original[edit.path];
    if (sha(source) !== edit.baseSha256)
      throw Error("Stale literal intent base hash");
    if (edit.find === edit.replace) throw Error("Unchanged literal intent");
    const found: number[] = [];
    for (
      let at = source.indexOf(edit.find);
      at !== -1;
      at = source.indexOf(edit.find, at + 1)
    )
      found.push(at);
    if (found.length !== edit.expectedMatches)
      throw Error("Literal match count differs from the validated intent");
    (spans[edit.path] ??= []).push(
      ...found.map((start) => ({
        start,
        end: start + edit.find.length,
        replacement: edit.replace,
      })),
    );
  }
  const files = { ...original };
  for (const [path, edits] of Object.entries(spans)) {
    edits.sort((a, b) => a.start - b.start);
    for (let i = 1; i < edits.length; i++)
      if (edits[i].start < edits[i - 1].end)
        throw Error("Overlapping original literal edits");
    let result = original[path];
    for (const edit of edits.toReversed())
      result =
        result.slice(0, edit.start) + edit.replacement + result.slice(edit.end);
    if (!utf8(result) || Buffer.byteLength(result) > 120000)
      throw Error("Compiled source byte limit");
    files[path] = result;
  }
  return { intent, files };
}
