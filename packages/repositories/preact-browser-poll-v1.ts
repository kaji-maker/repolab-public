const terminal = new Set(["ACCEPTED_INDEPENDENTLY_CORRECT", "ACCEPTED_INDEPENDENTLY_INCORRECT", "ABSTAINED", "ERROR", "CANCELLED", "INTERRUPTED", "INVALID_REPAIR_EVIDENCE"]);
/** A missing snapshot cannot finish a known submitted workflow. */
export function browserPollState(history: { id: string; active: boolean; status: string }[], awaiting: string | null) {
  const record = awaiting ? history.find(r => r.id === awaiting) : null;
  const pending = record && !record.active && terminal.has(record.status) ? null : awaiting;
  return { awaiting: pending, shouldPoll: pending !== null || history.some(r => r.active) };
}
