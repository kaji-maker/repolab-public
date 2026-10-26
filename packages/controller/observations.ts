import { z } from "zod";
import type { Execution } from "../contracts/index.ts";

export const observationProtocol = "repolab-observations/v1" as const;
export interface ExpectedObservation {
  id: string;
  expected: string | number;
}
export interface ObservedComparison extends ExpectedObservation {
  actual: string | number;
  passed: boolean;
}
const Value = z.union([
  z.string().max(4000),
  z.number().finite().min(-1_000_000_000).max(1_000_000_000),
]);
const Output = z.strictObject({
  protocol: z.literal(observationProtocol),
  runtimeVersion: z.string().regex(/^v24\.\d+\.\d+$/),
  observations: z
    .array(
      z.union([
        z.strictObject({
          id: z.string().max(64),
          status: z.literal("returned"),
          actual: Value,
        }),
        z.strictObject({
          id: z.string().max(64),
          status: z.enum(["threw", "unsupported"]),
        }),
      ]),
    )
    .min(1)
    .max(32),
});

/** Expected values come only from the controller, never from candidate stdout. */
export function inspectObservations(
  execution: Execution,
  expected: readonly ExpectedObservation[],
): { valid: boolean; rows: ObservedComparison[]; error?: string } {
  const invalid = (error: string) => ({ valid: false, rows: [], error });
  if (
    !expected.length ||
    expected.length > 32 ||
    new Set(expected.map((p) => p.id)).size !== expected.length ||
    expected.some(
      (p) =>
        !/^[a-z][a-z0-9-]{0,63}$/.test(p.id) ||
        !Value.safeParse(p.expected).success,
    )
  )
    return invalid("Invalid controller expectations");
  if (
    execution.timedOut !== false ||
    execution.truncated !== false ||
    execution.signal !== null ||
    execution.exitCode !== 0 ||
    new TextEncoder().encode(execution.stdout).length > 16_384
  )
    return invalid(
      "Execution evidence incomplete or observation process failed",
    );
  try {
    const body = Output.parse(JSON.parse(execution.stdout));
    if (body.runtimeVersion !== execution.runtimeVersion)
      return invalid("Observation runtime differs from execution evidence");
    if (
      body.observations.length !== expected.length ||
      new Set(body.observations.map((r) => r.id)).size !== expected.length
    )
      return invalid(
        "Required observation identities missing, extra or duplicated",
      );
    const rows = expected.map((probe) => {
      const result = body.observations.find((r) => r.id === probe.id);
      if (!result || result.status !== "returned") throw new Error();
      return {
        id: probe.id,
        actual: result.actual,
        expected: probe.expected,
        passed: result.actual === probe.expected,
      };
    });
    return { valid: true, rows };
  } catch {
    return invalid(
      "Observation output malformed, unsupported or contains a candidate exception",
    );
  }
}

type ObservationTarget = "booking" | "checkout" | "clsx";
export interface ObservationInput {
  id: string;
  args: unknown[];
}

/** Fixed runner. Only inputs are embedded; assertions/expected values stay outside. */
export function compileObservationRunner(
  target: ObservationTarget,
  inputs: ObservationInput[],
): string {
  const modules = {
    booking: { path: "src/bookings.mjs", name: "bookingDate" },
    checkout: { path: "src/checkout.mjs", name: "checkoutTotal" },
    clsx: { path: "src/index.js", name: "default" },
  };
  const module = modules[target];
  if (
    !module ||
    !inputs.length ||
    inputs.length > 32 ||
    new Set(inputs.map((p) => p.id)).size !== inputs.length
  )
    throw new Error("Invalid observation suite");
  return `// ${observationProtocol}: ${target}
import { writeSync } from 'node:fs';
// Capture output primitives before importing candidate code. This reduces
// same-process interference; it is not a hostile-code security boundary.
const write = writeSync;
const stringify = JSON.stringify;
const apply = Reflect.apply;
const create = Object.create;
const setPrototype = Object.setPrototypeOf;
const freeze = Object.freeze;
const keys = Object.keys;
const finite = Number.isFinite;
const exit = process.exit.bind(process);
const runtimeVersion = process.version;
const probes = ${JSON.stringify(inputs)};
const results = [];
setPrototype(results, null);
function freezeInput(value) {
  if (value && typeof value === 'object') {
    for (const key of keys(value)) freezeInput(value[key]);
    freeze(value);
  }
}
freezeInput(probes);
const fn = (await import('./${module.path}'))[${JSON.stringify(module.name)}];
let failed = false;
for (let index = 0; index < probes.length; index++) {
  const probe = probes[index];
  const record = create(null);
  record.id = probe.id;
  try {
    const actual = apply(fn, undefined, probe.args);
    if ((typeof actual === 'string' && actual.length <= 4000) ||
        (typeof actual === 'number' && finite(actual) && actual >= -1000000000 && actual <= 1000000000)) {
      record.status = 'returned';
      record.actual = actual;
    } else { record.status = 'unsupported'; failed = true; }
  } catch { record.status = 'threw'; failed = true; }
  results[index] = record;
}
const output = create(null);
output.protocol = '${observationProtocol}';
output.runtimeVersion = runtimeVersion;
output.observations = results;
write(1, stringify(output) + '\\n');
exit(failed ? 1 : 0);
`;
}
