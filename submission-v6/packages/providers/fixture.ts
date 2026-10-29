import {
  BookingContractSchema,
  ContractSchema,
  QuantityContractSchema,
} from "../contracts/index.ts";
import type {
  Proposer,
  BehaviorContract,
  Patch,
  Usage,
  Intake,
  Probe,
} from "../contracts/index.ts";
import { getProfile } from "../profiles/index.ts";
import type { z } from "zod";
import {
  extractClsxContract,
  clsxClarification,
  clsxExecutionBlocker,
} from "../repositories/clsx-contract.ts";

// The first profile intentionally requires explicit examples. This parser also
// acts as a source-grounding gate for live extracted expectations.
export function extractExplicitContract(
  report: string,
): z.infer<typeof BookingContractSchema> | null;
export function extractExplicitContract(
  report: string,
  profile: Intake["profile"],
): BehaviorContract | null;
export function extractExplicitContract(
  report: string,
  profile: Intake["profile"] = "booking-timezone",
): BehaviorContract | null {
  if (profile === "clsx-object-push") return extractClsxContract(report);
  if (profile === "checkout-quantity") {
    const matches = [
      ...report.matchAll(
        /For quantity (null|\d+) at unit price (\d+) cents, the expected total is (\d+) cents[^\n]*/g,
      ),
    ];
    if (!matches.length) return null;
    const result = QuantityContractSchema.safeParse({
      summary:
        "Preserve explicit quantities; default only a missing quantity. Totals use integer cents.",
      expectations: matches.map((match, index) => ({
        id: `reported-case-${index + 1}`,
        quantity: match[1] === "null" ? null : Number(match[1]),
        unitPriceCents: Number(match[2]),
        expected: Number(match[3]),
        sourceQuote: match[0],
      })),
    });
    return result.success ? result.data : null;
  }
  const matches = [
    ...report.matchAll(
      /For instant (\S+) at venue timezone ([\w/+-]+), the expected date is (\d{4}-\d{2}-\d{2})[^\n]*/g,
    ),
  ];
  if (!matches.length) return null;
  const expectations = matches.map((match, index) => ({
    id: `reported-case-${index + 1}`,
    instant: match[1],
    timeZone: match[2],
    expected: match[3],
    sourceQuote: match[0],
  }));
  const result = BookingContractSchema.safeParse({
    summary: "Use the venue timezone when deriving the booking calendar date.",
    expectations,
  });
  return result.success ? result.data : null;
}

function sameExpectation(left: Probe, right: Probe): boolean {
  if (
    left.expected !== right.expected ||
    left.sourceQuote !== right.sourceQuote
  )
    return false;
  if ("quantity" in left && "quantity" in right)
    return (
      left.quantity === right.quantity &&
      left.unitPriceCents === right.unitPriceCents
    );
  if ("args" in left && "args" in right)
    return JSON.stringify(left.args) === JSON.stringify(right.args);
  return (
    "instant" in left &&
    "instant" in right &&
    left.instant === right.instant &&
    left.timeZone === right.timeZone
  );
}

export function groundContract(
  report: string,
  contract: BehaviorContract,
  profile: Intake["profile"] = "booking-timezone",
): BehaviorContract {
  const explicit = extractExplicitContract(report, profile);
  if (!explicit)
    throw new Error(
      profile === "clsx-object-push"
        ? clsxClarification
        : getProfile(profile).clarification,
    );
  const used = new Set<string>();
  for (const expectation of contract.expectations) {
    const source = explicit.expectations.find((item) =>
      sameExpectation(item, expectation),
    );
    if (!source || used.has(source.id))
      throw new Error(
        "Expected behavior was not grounded in a distinct report example",
      );
    used.add(source.id);
  }
  if (used.size !== explicit.expectations.length)
    throw new Error("The extracted contract omitted a reported expectation");
  // Canonical IDs and report order belong to the controller, not the model.
  return ContractSchema.parse({
    summary: contract.summary,
    expectations: explicit.expectations,
  });
}

export class FixtureProposer implements Proposer {
  profile: Intake["profile"];
  constructor(profile: Intake["profile"] = "booking-timezone") {
    if (profile === "clsx-object-push") throw new Error(clsxExecutionBlocker);
    this.profile = profile;
  }
  provenance = "fixture" as const;
  model = "reviewed-fixture (no model inference)";
  rates = null;
  async extract(report: string) {
    const contract = extractExplicitContract(report, this.profile);
    return contract
      ? { contract }
      : {
          contract: null,
          clarification: getProfile(this.profile).clarification,
        };
  }
  async repair(context: { attempt: number }): Promise<Patch> {
    const profile = getProfile(this.profile);
    return {
      path: profile.path,
      content:
        context.attempt === 1
          ? profile.incompleteSource
          : profile.referenceSource,
      explanation:
        context.attempt === 1
          ? profile.incompleteExplanation
          : profile.referenceExplanation,
    };
  }
  takeUsage(): Usage[] {
    return [];
  }
}
