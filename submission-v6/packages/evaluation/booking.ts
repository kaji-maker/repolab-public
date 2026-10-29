import { readFile } from "node:fs/promises";
import { z } from "zod";
import { ProbeSchema } from "../contracts/index.ts";
import { evaluateSources } from "./cases.ts";
import { sha256 } from "../evidence/hash.ts";
import {
  originalSource,
  incompleteSource,
  referenceSource,
} from "../../fixtures/booking-timezone/profile.ts";

const CaseSchema = ProbeSchema.omit({ sourceQuote: true })
  .extend({
    origin: z.enum(["reported", "independent"]),
    rationale: z.string().min(10),
  })
  .strict();
const SuiteSchema = z.strictObject({
  id: z.literal("booking-timezone-development-v1"),
  split: z.literal("development"),
  cases: z.array(CaseSchema).min(1).max(50),
});

export async function loadBookingCases() {
  const text = await readFile(
    new URL("../../evaluation/booking-timezone/cases.json", import.meta.url),
    "utf8",
  );
  const suite = SuiteSchema.parse(JSON.parse(text));
  if (new Set(suite.cases.map((item) => item.id)).size !== suite.cases.length)
    throw new Error("Evaluation cases require distinct IDs");
  return { suite, suiteHash: sha256(text) };
}

// This evaluator is separate from the proposer/controller path. It executes
// only already reviewed fixtures; live candidate source still needs Sandboxes.
export async function evaluateBookingFixtures() {
  const { suite, suiteHash } = await loadBookingCases();
  const sources = [
    { id: "original", source: originalSource },
    { id: "reviewed-fixed-offset", source: incompleteSource },
    { id: "reviewed-reference", source: referenceSource },
  ];
  const results = await evaluateSources(suite.cases, sources);
  const original = results[0];
  const incomplete = results[1];
  const reference = results[2];
  const core = "reported-kathmandu";
  const qualified =
    results.every((item) => item.environmentErrors === 0) &&
    reference.passed === suite.cases.length &&
    original.rows.find((row) => row.caseId === core)?.verdict ===
      "ASSERTION_FAILURE" &&
    incomplete.rows.find((row) => row.caseId === core)?.verdict === "PASS" &&
    incomplete.rows.some(
      (row) =>
        row.origin === "independent" && row.verdict === "ASSERTION_FAILURE",
    );
  return {
    schemaVersion: 1,
    createdAt: new Date().toISOString(),
    suiteId: suite.id,
    suiteHash,
    split: suite.split,
    qualified,
    inferenceCalls: 0,
    execution: "trusted-fixture" as const,
    runtimeVersion: process.version,
    icuVersion: process.versions.icu,
    timezoneDataVersion: process.versions.tz,
    caseCount: suite.cases.length,
    independentCaseCount: suite.cases.filter(
      (item) => item.origin === "independent",
    ).length,
    results,
    limitations: [
      "One constructed profile; these assertions are development cases, not held-out bug-repair tasks.",
      "Only reviewed fixture modules were executed. No NVIDIA-generated patch was evaluated.",
      "Model repair accuracy and the planned three-arm comparison remain unmeasured.",
    ],
  };
}
