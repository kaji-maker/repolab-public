import { z } from "zod";
import { DatabaseSync } from "node:sqlite";
import { existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { ProviderDiagnosticSchema } from "../providers/diagnostics.ts";

export const ReceiptSchema = z
  .strictObject({
    format: z.literal("repolab-charge-reconciliation/v1"),
    reservationId: z.uuid(),
    source: z.enum([
      "provider_usage_record",
      "provider_confirmation",
      "operator_confirmation",
    ]),
    providerRecordId: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.:/-]{0,127}$/),
    operator: z.string().regex(/^[A-Za-z0-9_.-]{1,48}$/),
    observedAt: z.iso.datetime(),
    attemptId: z.uuid(),
    model: ProviderDiagnosticSchema.shape.model,
    attemptStartedAt: z.iso.datetime(),
    requestId: ProviderDiagnosticSchema.shape.requestId,
    evidenceSha256: z.string().regex(/^[a-f0-9]{64}$/),
    conclusion: z.enum(["provider_charge", "confirmed_no_charge"]),
    actualUsd: z.number().finite().nonnegative(),
  })
  .refine(
    (r) =>
      r.conclusion === "confirmed_no_charge"
        ? r.actualUsd === 0
        : r.actualUsd > 0,
    "Charge conclusion and amount disagree",
  )
  .refine(
    (r) =>
      r.source !== "operator_confirmation" ||
      (r.conclusion === "confirmed_no_charge" && r.actualUsd === 0),
    "Operator confirmation only attests zero charge",
  );
export type ReconciliationReceipt = z.infer<typeof ReceiptSchema>;
export const AttemptContextSchema = z.strictObject({
  attemptId: z.uuid(),
  model: ProviderDiagnosticSchema.shape.model,
  startedAt: z.iso.datetime(),
  requestId: ProviderDiagnosticSchema.shape.requestId,
});
export type AttemptContext = z.infer<typeof AttemptContextSchema>;

/** Explicitly sourced evidence; hashes do not authenticate a provider or operator. */
export function validateReconciliation(
  input: unknown,
  evidence: Uint8Array,
  context: unknown,
): ReconciliationReceipt {
  const receipt = ReceiptSchema.parse(input);
  const attempt = AttemptContextSchema.parse(context);
  if (
    !evidence.byteLength ||
    evidence.byteLength > 1_048_576 ||
    createHash("sha256").update(evidence).digest("hex") !==
      receipt.evidenceSha256
  )
    throw Error("Provider evidence is missing, oversized or changed");
  if (
    receipt.attemptId !== attempt.attemptId ||
    receipt.model !== attempt.model ||
    receipt.attemptStartedAt !== attempt.startedAt ||
    (attempt.requestId !== null && receipt.requestId !== attempt.requestId)
  )
    throw Error("Receipt does not match the retained local request");
  if (Date.parse(receipt.observedAt) < Date.parse(receipt.attemptStartedAt))
    throw Error("Provider evidence predates the request");
  return receipt;
}

/** Read-only, credential-free status; it never creates or migrates a database. */
export function readLedgerStatus(path: string) {
  if (!existsSync(path))
    return {
      exists: false,
      blocked: false,
      charges: [],
      diagnostics: [],
      reconciliations: [],
      totalCommittedUsd: 0,
    };
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    const charges = db
      .prepare("SELECT id,reserved,actual,state FROM charges ORDER BY rowid")
      .all();
    const tables = new Set(
      db
        .prepare("SELECT name FROM sqlite_master WHERE type='table'")
        .all()
        .map((r) => r.name),
    );
    const diagnostics = tables.has("charge_diagnostics")
      ? db
          .prepare("SELECT payload FROM charge_diagnostics ORDER BY rowid")
          .all()
          .map((r) =>
            ProviderDiagnosticSchema.parse(JSON.parse(String(r.payload))),
          )
      : [];
    const reconciliations = tables.has("charge_reconciliations")
      ? db
          .prepare("SELECT payload FROM charge_reconciliations ORDER BY rowid")
          .all()
          .map((r) => JSON.parse(String(r.payload)))
      : [];
    return {
      exists: true,
      blocked: charges.some((r) => r.state !== "settled"),
      charges,
      diagnostics,
      reconciliations,
      totalCommittedUsd: charges.reduce(
        (sum, r) => sum + Number(r.state === "settled" ? r.actual : r.reserved),
        0,
      ),
    };
  } finally {
    db.close();
  }
}
