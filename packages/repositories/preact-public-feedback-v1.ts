import { z } from "zod";
import { parseAdmissionReceipt } from "../execution/preact-admission-v5.ts";
import { admissionObservations } from "../evaluation/preact-admission-v5.ts";
import { shaNative } from "../evaluation/preact-native-v5.ts";

// Public report checks only. No independent expectations are imported or opened.
const expected = [
  { id: "returned-cleanup", events: ["mount", "cleanup"] },
  { id: "legacy-callback", events: ["mount", "null"] },
  { id: "object-ref", events: ["INPUT", "cleared"] },
];

/** Reparse a complete raw receipt against controller-owned identities before feedback. */
export function preactPublicFeedback(
  raw: unknown,
  stage: string,
  id: string,
  image: string,
  sourceHash: string,
) {
  z.enum(["public-A", "public-B"]).parse(stage);
  z.string()
    .regex(/^[a-f0-9]{64}$/)
    .parse(sourceHash);
  const result = parseAdmissionReceipt(raw, stage, id, image, sourceHash);
  if (admissionObservations(expected, "public").passed !== expected.length)
    throw Error("Public expectation registry changed");
  const observations = admissionObservations(
    result.guest.observations,
    "public",
  );
  if (!observations.failed.length)
    throw Error("Passing receipt is not failure feedback");
  return {
    kind: "public",
    stage,
    origin:
      "unchanged public report checks; controller comparison of actual Sandbox observations",
    binding: {
      sourceHash,
      operationId: id,
      image,
      receiptHash: shaNative(JSON.stringify(result.op)),
    },
    observations,
    failures: observations.rows.flatMap((row, i) =>
      observations.failed.includes(row.id)
        ? [
            {
              id: row.id,
              expectedEvents: expected[i].events,
              actualEvents: row.events,
              ...(row.observedError
                ? { observedError: row.observedError }
                : {}),
            },
          ]
        : [],
    ),
  };
}
