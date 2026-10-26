import { z } from "zod";
import { createHash } from "node:crypto";

const sha = (value: string) => createHash("sha256").update(value).digest("hex");
const schema = z.strictObject({
  format: z.literal("repolab-public-api-inventory/v1"),
  taskId: z.string(),
  commit: z.string().regex(/^[a-f0-9]{40}$/),
  variants: z
    .array(
      z.strictObject({
        id: z.string().regex(/^[a-z0-9-]+$/),
        entrypoint: z.string(),
        options: z.record(z.string(), z.unknown()),
        sourcePaths: z.array(z.string()).min(1),
        evidence: z
          .array(
            z.strictObject({
              path: z.string(),
              sha256: z.string(),
              excerpt: z.string().min(1).max(600),
            }),
          )
          .min(1),
        publicCaseIds: z.array(z.string()).min(2),
      }),
    )
    .min(1)
    .max(24),
});

export function validatePublicApiInventory(
  manifest: {
    id: string;
    commit: string;
    sourcePaths: string[];
    files: Record<string, { sha256: string }>;
    contextFiles: Record<string, string>;
  },
  value: unknown,
  cases: {
    id: string;
    variant: string;
    kind: "report" | "control";
    input: { options: unknown };
  }[],
) {
  const inventory = schema.parse(value);
  if (inventory.taskId !== manifest.id || inventory.commit !== manifest.commit)
    throw Error("Inventory task identity changed");
  const variants = new Set<string>(),
    used = new Set<string>(),
    sources = new Set<string>();
  if (new Set(cases.map((c) => c.id)).size !== cases.length)
    throw Error("Duplicate public case");
  for (const variant of inventory.variants) {
    if (variants.has(variant.id)) throw Error("Duplicate API variant");
    variants.add(variant.id);
    for (const path of variant.sourcePaths) {
      if (!manifest.sourcePaths.includes(path))
        throw Error("Undeclared inventory source");
      sources.add(path);
    }
    for (const evidence of variant.evidence) {
      const text = manifest.contextFiles[evidence.path];
      if (
        typeof text !== "string" ||
        sha(text) !== evidence.sha256 ||
        manifest.files[evidence.path]?.sha256 !== evidence.sha256 ||
        !text.includes(evidence.excerpt)
      )
        throw Error("Public API evidence changed");
    }
    const covered = variant.publicCaseIds.map((id) => {
      const c = cases.find((c) => c.id === id);
      if (
        !c ||
        used.has(id) ||
        c.variant !== variant.id ||
        JSON.stringify(c.input.options) !== JSON.stringify(variant.options)
      )
        throw Error("API variant public coverage changed");
      used.add(id);
      return c;
    });
    if (
      !covered.some((c) => c.kind === "report") ||
      !covered.some((c) => c.kind === "control")
    )
      throw Error("API variant needs a report and an ordinary control");
  }
  if (
    used.size !== cases.length ||
    sources.size !== manifest.sourcePaths.length
  )
    throw Error("Public API inventory is incomplete");
  return { inventory, sha256: sha(JSON.stringify(inventory)) };
}
