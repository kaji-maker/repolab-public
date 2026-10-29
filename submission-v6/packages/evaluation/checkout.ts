import { readFile } from "node:fs/promises";
import { z } from "zod";
import { QuantityProbeSchema } from "../contracts/index.ts";
import { sha256 } from "../evidence/hash.ts";
import { evaluateSources } from "./cases.ts";
import {
  originalSource,
  incompleteSource,
  referenceSource,
} from "../../fixtures/checkout-quantity/profile.ts";

const SuiteSchema = z.strictObject({
  id: z.literal("checkout-quantity-development-v1"),
  split: z.literal("development"),
  cases: z
    .array(
      QuantityProbeSchema.omit({ sourceQuote: true })
        .extend({
          origin: z.enum(["reported", "independent", "baseline"]),
          rationale: z.string().min(10),
        })
        .strict(),
    )
    .min(1)
    .max(50),
});

export async function evaluateCheckoutFixtures() {
  const text = await readFile(
    new URL("../../evaluation/checkout-quantity/cases.json", import.meta.url),
    "utf8",
  );
  const suite = SuiteSchema.parse(JSON.parse(text));
  if (new Set(suite.cases.map((item) => item.id)).size !== suite.cases.length)
    throw new Error("Evaluation cases require distinct IDs");
  const results = await evaluateSources(suite.cases, [
    { id: "original", source: originalSource },
    { id: "reviewed-zero-special-case", source: incompleteSource },
    { id: "reviewed-reference", source: referenceSource },
  ]);
  const qualified =
    results.every((item) => item.environmentErrors === 0) &&
    results[2].passed === suite.cases.length &&
    results[0].rows.find((row) => row.caseId === "zero-quantity")?.verdict ===
      "ASSERTION_FAILURE" &&
    results[1].rows.find((row) => row.caseId === "zero-quantity")?.verdict ===
      "PASS" &&
    results[1].rows.some(
      (row) =>
        row.origin === "independent" && row.verdict === "ASSERTION_FAILURE",
    );
  return {
    schemaVersion: 1,
    createdAt: new Date().toISOString(),
    suiteId: suite.id,
    suiteHash: sha256(text),
    split: suite.split,
    qualified,
    inferenceCalls: 0,
    execution: "trusted-fixture" as const,
    runtimeVersion: process.version,
    caseCount: suite.cases.length,
    independentCaseCount: suite.cases.filter(
      (item) => item.origin === "independent",
    ).length,
    results,
    limitations: [
      "Development assertions for one constructed checkout module; not held-out bug tasks.",
      "Only reviewed fixtures were executed; NVIDIA-generated patch correctness remains unmeasured.",
    ],
  };
}
