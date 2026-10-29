import { readFileSync, existsSync } from "node:fs";
import { auditEvaluationProtocol } from "../evaluation/protocol.ts";
import { sandboxConfigFromEnv } from "../execution/nebius.ts";
import { configFromEnv } from "../providers/nebius.ts";
import { requestPolicyParameters } from "../providers/request-policy.ts";
import { admitClsxPilot } from "./admission.ts";
import type { Store } from "../storage/store.ts";

/** Read-only preflight; no provider construction, source execution or reservation. */
export function assertRepairReady(store: Store) {
  if (existsSync(".repolab/repositories/clsx-repair.lock"))
    throw Error(
      "Another repair holds the lease; finish it or explicitly recover a stale lease",
    );
  const protocol = auditEvaluationProtocol();
  const inference = configFromEnv();
  if (
    !inference.apiKey ||
    inference.model !== protocol.comparison.model ||
    inference.inputRate !== protocol.comparison.ratesUsdPerMillion.input ||
    inference.outputRate !== protocol.comparison.ratesUsdPerMillion.output ||
    JSON.stringify({
      max_tokens: 4096,
      ...requestPolicyParameters("nemotron-low-effort-v1", inference.model),
    }) !== JSON.stringify(protocol.comparison.parameters)
  )
    throw Error(
      "Configure the frozen NVIDIA inference settings before starting",
    );
  const cap = Number(process.env.REPOLAB_DEVELOPMENT_BUDGET_USD ?? 4);
  if (
    !Number.isFinite(cap) ||
    cap <= 0 ||
    cap > 4 ||
    store.totalSpent() + 0.1 > cap
  )
    throw Error("The bounded development allocation cannot cover this repair");
  // Pending/uncertain usage must block sandbox work as well as the next model call.
  if (store.hasUnsettledCharges())
    throw Error(
      "Reconcile pending or uncertain usage before starting another repair",
    );
  admitClsxPilot(
    JSON.parse(
      readFileSync("fixtures/clsx-upstream/original-snapshot.json", "utf8"),
    ),
    sandboxConfigFromEnv(),
  );
}
export function repairReadiness(store: Store) {
  try {
    assertRepairReady(store);
    return {
      available: true,
      reason:
        "Certified fixed-task repair is ready. Starting uses live inference and isolated execution.",
    };
  } catch {
    return {
      available: false,
      reason:
        "Repair is unavailable. Check the ledger, NVIDIA configuration and fresh sandbox smoke/preparation certificates with the local CLI.",
    };
  }
}
