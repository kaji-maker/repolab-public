export interface NativeReviewRecord {
  status: string;
  active: boolean;
  verified: boolean;
  simulated: boolean;
  accepted: boolean;
  sourceHash: string | null;
  native: unknown;
  public: { passed: number; total: number } | null;
  independent: { passed: number; total: number } | null;
}
/** Presentation guard only. API correctness remains grounded in its raw audit. */
export function nativeReviewDisposition(record: NativeReviewRecord) {
  const proofBadgeAllowed = !!(
    record.verified &&
    !record.simulated &&
    !record.active &&
    record.accepted &&
    record.status === "ACCEPTED_INDEPENDENTLY_CORRECT" &&
    /^[a-f0-9]{64}$/.test(record.sourceHash ?? "") &&
    record.native &&
    record.public &&
    record.public.total > 0 &&
    record.public.passed === record.public.total &&
    record.independent &&
    record.independent.total > 0 &&
    record.independent.passed === record.independent.total
  );
  return {
    proofBadgeAllowed,
    unrunSelectionLabel: record.active ? "Pending" : "Not reached",
    abstentionExplanation:
      record.status === "ABSTAINED"
        ? "No candidate passed selection. Independent checks were not opened."
        : null,
  };
}
