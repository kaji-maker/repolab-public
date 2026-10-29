import * as booking from "../../fixtures/booking-timezone/profile.ts";
import * as checkout from "../../fixtures/checkout-quantity/profile.ts";
import type { Intake } from "../contracts/index.ts";
import { clsxExecutionBlocker } from "../repositories/clsx-contract.ts";

const profiles = {
  "booking-timezone": {
    ...booking,
    path: "src/bookings.mjs" as const,
    clarification:
      "Give an example in this format: For instant 2026-10-03T20:00:00Z at venue timezone Asia/Kathmandu, the expected date is 2026-10-04.",
    incompleteExplanation:
      "Deliberately incomplete fixture: a fixed offset only handles the first report example.",
    referenceExplanation:
      "Reviewed fixture: derive calendar parts using the requested IANA timezone.",
  },
  "checkout-quantity": {
    ...checkout,
    path: "src/checkout.mjs" as const,
    clarification:
      "Give explicit quantity, unit price and expected integer-cent examples: For quantity 0 at unit price 250 cents, the expected total is 0 cents. Use null for a missing quantity.",
    incompleteExplanation:
      "Deliberately incomplete fixture: zero is handled, but every nonzero quantity is charged as one item.",
    referenceExplanation:
      "Reviewed fixture: default only a missing quantity, preserving zero and ordinary multiplication.",
  },
};

export function getProfile(id: Intake["profile"]) {
  if (id === "clsx-object-push") throw new Error(clsxExecutionBlocker);
  const profile = profiles[id];
  if (!profile) throw new Error("Unknown repository profile");
  return profile;
}

export const profileSummaries = Object.values(profiles).map(
  (profile) => profile.profileSummary,
);
export const reviewedSources = Object.values(profiles).flatMap((profile) =>
  [
    profile.originalSource,
    profile.incompleteSource,
    profile.referenceSource,
  ].map((source) => ({ source, path: profile.path })),
);
