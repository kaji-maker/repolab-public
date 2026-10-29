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
    return {
      id: c.id,
      variant: c.variant,
      kind: c.kind,
      program: programs.indexOf(c.program),
      input: c.input,
      expected: c.expected,
    };
  });
  return {
    apiInventory: {
      sha256: validated.sha256,
      variants: validated.inventory.variants.map(({ evidence, ...v }) => v),
    },
    publicObservations: { programs, observations },
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
