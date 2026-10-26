import { existsSync, readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { configFromEnv } from "../../packages/providers/nebius.ts";
import { NebiusThinkingProposer } from "../../packages/providers/nebius-thinking-v1.ts";
import { Store } from "../../packages/storage/store.ts";
import { acquireRepairLease } from "../../packages/repositories/repair-lease.ts";
import { assertTrialNoCredentials } from "../../packages/evaluation/preact-trial-v9.ts";
import { programProposalSchema } from "../../packages/repositories/preact-generation-v2.ts";
import {
  auditProbeFreeze,
  PROBE_FREEZE,
  probeSettings,
  probeSystem,
  probeContext,
  probeRequest,
  validateProbeReply,
} from "../../packages/evaluation/preact-thinking-schema-v1.ts";
import { shaNative } from "../../packages/evaluation/preact-native-v5.ts";
const directory = ".repolab/preact-thinking-schema-v1/run";
const read = (name: string) =>
  JSON.parse(readFileSync(join(directory, name + ".json"), "utf8"));
async function save(name: string, value: unknown, exclusive = false) {
  assertTrialNoCredentials(value);
  await writeFile(
    join(directory, name + ".json"),
    JSON.stringify(value, null, 2) + "\n",
    { mode: 0o600, ...(exclusive ? { flag: "wx" } : {}) },
  );
}
export function auditThinkingSchemaProbe(reader = read) {
  auditProbeFreeze();
  const result = reader("result"),
    start = reader("STARTED"),
    request = reader("request"),
    completion = reader("completion"),
    diagnostic = reader("diagnostic");
  if (
    start.freeze !== PROBE_FREEZE ||
    result.freeze !== PROBE_FREEZE ||
    JSON.stringify(request.body) !== JSON.stringify(probeRequest()) ||
    request.hash !== shaNative(JSON.stringify(request.body)) ||
    diagnostic.requestHash !== request.hash ||
    diagnostic.httpStatus !== 200 ||
    diagnostic.accounting !== "settled" ||
    diagnostic.outcome !== "completed" ||
    diagnostic.finishReason !== "stop" ||
    completion.model !== probeSettings.model ||
    completion.choices[0].finishReason !== "stop" ||
    !completion.choices[0].reasoning?.present ||
    !Number.isInteger(completion.choices[0].reasoning?.bytes) ||
    completion.choices[0].reasoning.bytes < 1 ||
    !/^[a-f0-9]{64}$/.test(completion.choices[0].reasoning.sha256 ?? "")
  )
    throw Error("Schema probe request/completion binding changed");
  if (!(
    Date.parse(start.at) <= Date.parse(request.at) &&
    Date.parse(request.at) <= Date.parse(completion.at) &&
    Date.parse(completion.at) <= Date.parse(result.at)
  ))
    throw Error("Schema probe chronology changed");
  const actual = JSON.parse(completion.choices[0].content);
  if (JSON.stringify(actual) !== JSON.stringify(reader("reply")))
    throw Error("Stored schema reply differs from actual completion");
  const expected = validateProbeReply(actual),
    cost =
      (completion.usage.prompt_tokens * probeSettings.rates.input +
        completion.usage.completion_tokens * probeSettings.rates.output) /
      1000000;
  if (
    result.status !== "QUALIFIED_THINKING_REQUEST" ||
    JSON.stringify(result.qualification) !== JSON.stringify(expected) ||
    result.calls !== 1 ||
    result.operations !== 0 ||
    result.costUsd !== cost ||
    diagnostic.usage.costUsd !== cost ||
    diagnostic.usage.inputTokens !== completion.usage.prompt_tokens ||
    diagnostic.usage.outputTokens !== completion.usage.completion_tokens
  )
    throw Error("Schema probe result/accounting changed");
  if (
    JSON.stringify(result.reasoning) !==
    JSON.stringify(completion.choices[0].reasoning)
  )
    throw Error("Observed reasoning metadata changed");
  assertTrialNoCredentials(result);
  return result;
}
async function run() {
  auditProbeFreeze();
  if (existsSync(join(directory, "STARTED.json")))
    throw Error("Schema probe already started; no retry");
  const cfg = configFromEnv();
  if (
    cfg.model !== probeSettings.model ||
    cfg.baseUrl !== probeSettings.baseUrl ||
    cfg.inputRate !== probeSettings.rates.input ||
    cfg.outputRate !== probeSettings.rates.output
  )
    throw Error("Schema probe configuration changed");
  const store = new Store(".repolab/state.sqlite");
  if (store.hasUnsettledCharges()) {
    store.close();
    throw Error("Unsettled charges block schema dispatch");
  }
  const releases: (() => Promise<void>)[] = [];
  let calls = 0;
  try {
    releases.push(
      await acquireRepairLease(".repolab", "preact-thinking-schema-v1"),
    );
    releases.push(
      await acquireRepairLease(
        ".repolab/repositories",
        "preact-thinking-schema-v1",
      ),
    );
    await mkdir(directory, { recursive: true, mode: 0o700 });
    await save(
      "STARTED",
      {
        freeze: PROBE_FREEZE,
        at: new Date().toISOString(),
        purpose: "one schema-only call; no candidate source execution",
      },
      true,
    );
    const provider = new NebiusThinkingProposer({
      ...cfg,
      budgetUsd: Number.MAX_SAFE_INTEGER,
      reserve: (amount) =>
        store.reserve(shaNative(cfg.apiKey), amount, Number.MAX_SAFE_INTEGER),
      settle: (id, cost) => store.settle(id, cost),
      fetch: async (url, init) => {
        auditProbeFreeze();
        if (calls++) throw Error("Schema call slot exhausted");
        const body = JSON.parse(String(init?.body));
        if (JSON.stringify(body) !== JSON.stringify(probeRequest()))
          throw Error("Schema request changed");
        await save(
          "request",
          {
            body,
            hash: shaNative(JSON.stringify(body)),
            at: new Date().toISOString(),
          },
          true,
        );
        return fetch(url, init);
      },
      onCompletion: async (c) =>
        save("completion", { ...c, at: new Date().toISOString() }, true),
      onDiagnostic: async (d) => {
        assertTrialNoCredentials(d);
        if (d.reservationId) store.recordDiagnostic(d.reservationId, d);
        await save("diagnostic", d, true);
      },
    });
    const reply = await provider.structured(
      "preact_thinking_schema_probe_v1",
      probeSystem,
      JSON.stringify(probeContext()),
      programProposalSchema,
    );
    await save("reply", reply, true);
    const usage = provider.takeUsage();
    if (usage.length !== 1) throw Error("Schema usage incomplete");
    const completion = read("completion");
    if (!completion.choices[0].reasoning.present)
      throw Error(
        "Request accepted but no reasoning channel observed; qualification unavailable",
      );
    const result = {
      freeze: PROBE_FREEZE,
      status: "QUALIFIED_THINKING_REQUEST",
      calls,
      operations: 0,
      costUsd: usage[0].costUsd,
      qualification: validateProbeReply(reply),
      reasoning: completion.choices[0].reasoning,
      at: new Date().toISOString(),
    };
    await save("result", result, true);
    console.log(JSON.stringify(result));
  } catch (e) {
    if (existsSync(join(directory, "STARTED.json")))
      await save(
        "error",
        {
          freeze: PROBE_FREEZE,
          status: "ERROR",
          calls,
          operations: 0,
          reason: e instanceof Error ? e.message : "Schema qualification error",
          inference: calls ? "nebius" : "none",
          execution: "none",
          at: new Date().toISOString(),
        },
        true,
      );
    throw e;
  } finally {
    for (const release of releases.reverse()) await release();
    store.close();
  }
}
if (process.argv[1]?.endsWith("apps/evaluator/preact-thinking-schema-v1.ts")) {
  const action = process.argv[2] ?? "plan";
  (async () => {
    if (action === "run") await run();
    else if (action === "audit")
      console.log(JSON.stringify(auditThinkingSchemaProbe()));
    else if (action === "plan") console.log(JSON.stringify(auditProbeFreeze()));
    else throw Error("Use plan, run or audit");
  })().catch((e) => {
    console.error(e instanceof Error ? e.message : "Schema probe failed");
    process.exitCode = 1;
  });
}
