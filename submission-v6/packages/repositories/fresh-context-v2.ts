import { validatePublicApiInventory } from "./public-api-inventory-v1.ts";

export function freshPublicContext(
  manifest: any,
  inventory: unknown,
  cases: any[],
) {
  const validated = validatePublicApiInventory(manifest, inventory, cases);
  const programs: string[] = [];
  const observations = cases.map((c) => {
    if (!programs.includes(c.program)) programs.push(c.program);
    const { options, ...input } = c.input;
    return [
      c.id,
      c.variant,
      c.kind,
      programs.indexOf(c.program),
      input,
      c.expected,
    ];
  });
  return {
    apiInventory: {
      sha256: validated.sha256,
      variants: validated.inventory.variants.map(
        ({ evidence, publicCaseIds, ...v }) => v,
      ),
    },
    publicObservations: {
      columns: ["id", "variant", "kind", "program", "input", "expected"],
      optionsFrom:
        "apiInventory.variants options keyed by variant id; merge into each case input.options",
      programs,
      observations,
    },
  };
}

export function checkPublicControls(guest: any, cases: any[]) {
  for (const [i, c] of cases.entries()) {
    if (
      c.kind === "control" &&
      (guest.rows?.[i]?.id !== c.id || guest.rows[i].passed !== true)
    )
      throw Error("Ordinary public API control failed: " + c.id);
  }
}
