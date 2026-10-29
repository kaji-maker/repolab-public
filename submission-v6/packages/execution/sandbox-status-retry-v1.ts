import { setTimeout as delay } from "node:timers/promises";
import { SandboxTransportError, SandboxTransportJournalError } from "./sandbox-transport-v1.ts";
import type { SandboxJsonOutcome, SandboxJsonRequest } from "./sandbox-transport-v1.ts";

const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
export const STATUS_RETRY_DELAYS_MS = Object.freeze([1000, 2000] as const);
export const STATUS_RETRY_HTTP_STATUSES = Object.freeze([500, 502, 503, 504] as const);
export interface SandboxStatusRetryBudget { operationId: string; remainingRetries: number; }
export type SandboxStatusPause = (milliseconds: number, signal: AbortSignal) => Promise<void>;
const pause: SandboxStatusPause = async (milliseconds, signal) => { await delay(milliseconds, undefined, { signal }); };

export function createSandboxStatusRetryBudget(operationId: string): SandboxStatusRetryBudget {
  if (!uuid.test(operationId)) throw Error("Exact operation UUID required for status reads");
  return { operationId, remainingRetries: STATUS_RETRY_DELAYS_MS.length };
}

/** At most two extra GETs for one operation; the budget is shared across all its polls. */
export async function readSandboxOperationWithRetry(
  operationId: string,
  signal: AbortSignal,
  readOnce: (request: Readonly<SandboxJsonRequest>, attempt: number) => Promise<SandboxJsonOutcome>,
  budget: SandboxStatusRetryBudget,
  wait: SandboxStatusPause = pause,
): Promise<SandboxJsonOutcome> {
  const validate = () => {
    if (!uuid.test(operationId) || budget.operationId !== operationId ||
        !Number.isInteger(budget.remainingRetries) || budget.remainingRetries < 0 || budget.remainingRetries > 2)
      throw Error("Exact bounded operation status budget required");
    if (signal.aborted) throw Error("Operation status read interrupted");
  };
  validate();
  const request = Object.freeze({ route: "operations/" + operationId, method: "GET" as const });
  for (let attempt = 1; attempt <= 3; attempt++) {
    validate();
    try {
      const result = await readOnce(request, attempt);
      const d = result.diagnostic;
      if (!result.ok || d.category !== "success" || d.method !== "GET" || d.resource !== "operation" ||
          d.operationId !== operationId || d.acceptance !== "NOT_APPLICABLE" || !d.attempted ||
          d.httpStatus === null || d.httpStatus < 200 || d.httpStatus >= 300)
        throw Error("Validated exact operation status response required");
      return result;
    } catch (error) {
      if (signal.aborted) throw Error("Operation status read interrupted");
      if (!(error instanceof SandboxTransportError) || error instanceof SandboxTransportJournalError) throw error;
      validate();
      const d = error.diagnostic;
      if (attempt === 3 || budget.remainingRetries === 0 || d.method !== "GET" || d.resource !== "operation" ||
          d.operationId !== operationId || !d.attempted || d.acceptance !== "NOT_APPLICABLE" || d.category !== "http_error" ||
          !STATUS_RETRY_HTTP_STATUSES.some(status => status === d.httpStatus) ||
          !["json", "empty"].includes(d.bodyState) ||
          (d.providerCode !== null && !["INTERNAL", "UNAVAILABLE", 13, 14].includes(d.providerCode))) throw error;
      const milliseconds = STATUS_RETRY_DELAYS_MS[2 - budget.remainingRetries];
      budget.remainingRetries--;
      try { await wait(milliseconds, signal); }
      catch { throw Error("Operation status retry wait interrupted"); }
    }
  }
  throw Error("Operation status read budget exhausted");
}
