import type { Probe } from "../contracts/index.ts";
import {
  ProbeSchema,
  QuantityProbeSchema,
  ClsxProbeSchema,
  ClsxArgsSchema,
} from "../contracts/index.ts";
import { z } from "zod";
import { compileObservationRunner } from "./observations.ts";

type WithoutQuote<T> = T extends unknown ? Omit<T, "sourceQuote"> : never;
export type TestProbe = WithoutQuote<Probe>;

// Input is data, not executable model text. Each assertion becomes identical
// bytes on both sides of the repair, and the controller freezes those bytes.
export function compileTests(
  probes: TestProbe[],
  version: 1 | 2 | 3 = 3,
): string {
  const checkout = probes.length > 0 && "quantity" in probes[0];
  const clsx = probes.length > 0 && "args" in probes[0];
  if (clsx && version !== 3)
    throw new Error("clsx only supports controller observation runners");
  const schema = clsx
    ? ClsxProbeSchema.omit({ sourceQuote: true })
    : checkout
      ? QuantityProbeSchema.omit({ sourceQuote: true })
      : ProbeSchema.omit({ sourceQuote: true });
  probes = probes.map((probe) => schema.parse(probe));
  if (!probes.length || new Set(probes.map((p) => p.id)).size !== probes.length)
    throw new Error("Tests require distinct probes");
  if (version === 3)
    return compileObservationRunner(
      clsx ? "clsx" : checkout ? "checkout" : "booking",
      probes.map((p) => ({
        id: p.id,
        args:
          "args" in p
            ? p.args
            : "quantity" in p
              ? [p.quantity, p.unitPriceCents]
              : [p.instant, p.timeZone],
      })),
    );
  return `import assert from 'node:assert/strict';
import { writeSync } from 'node:fs';
import { ${checkout ? "checkoutTotal" : "bookingDate"} } from './src/${checkout ? "checkout" : "bookings"}.mjs';
const probes = ${JSON.stringify(probes, null, 2)};
const results = [];
for (const probe of probes) {
${version === 2 ? "  let actual;\n" : ""}  try {
    ${version === 2 ? "actual" : "const actual"} = ${checkout ? "checkoutTotal(probe.quantity, probe.unitPriceCents)" : "bookingDate(probe.instant, probe.timeZone)"};
    assert.equal(actual, probe.expected);
    results.push({ id: probe.id, passed: true, actual, expected: probe.expected });
  } catch (error) {
    results.push({ id: probe.id, passed: false, ${version === 2 ? "actual, " : ""}expected: probe.expected,
      assertion: error.code === 'ERR_ASSERTION', error: String(error.message).slice(0, 1000) });
  }
}

writeSync(1, JSON.stringify({ runtimeVersion: process.version, results }) + '\\n');
process.exitCode = results.every(result => result.passed) ? 0 : 1;
`;
}

export function validateCompiledTests(
  source: string,
  allowLegacy = true,
): "src/bookings.mjs" | "src/checkout.mjs" | "src/index.js" {
  const start = source.indexOf("const probes = ");
  const end = source.indexOf(";\nconst results = [];", start);
  if (start < 0 || end < 0)
    throw new Error("Unrecognized fixture test harness");
  const probes = JSON.parse(
    source.slice(start + "const probes = ".length, end),
  );
  if (source.startsWith("// repolab-observations/v1:")) {
    const checkout = source.startsWith(
      "// repolab-observations/v1: checkout\n",
    );
    const clsx = source.startsWith("// repolab-observations/v1: clsx\n");
    const schema = z.strictObject({
      id: ProbeSchema.shape.id,
      args: clsx
        ? ClsxArgsSchema
        : checkout
          ? z.tuple([
              QuantityProbeSchema.shape.quantity,
              QuantityProbeSchema.shape.unitPriceCents,
            ])
          : z.tuple([ProbeSchema.shape.instant, ProbeSchema.shape.timeZone]),
    });
    const inputs = z.array(schema).min(1).max(32).parse(probes);
    if (
      compileObservationRunner(
        clsx ? "clsx" : checkout ? "checkout" : "booking",
        inputs,
      ) !== source
    )
      throw new Error("Fixture harness was modified");
    return clsx
      ? "src/index.js"
      : checkout
        ? "src/checkout.mjs"
        : "src/bookings.mjs";
  }
  if (
    !allowLegacy ||
    !Array.isArray(probes) ||
    (compileTests(probes, 2) !== source && compileTests(probes, 1) !== source)
  )
    throw new Error("Fixture harness was modified");
  return "quantity" in probes[0] ? "src/checkout.mjs" : "src/bookings.mjs";
}
