import type { CommonTask } from "./study-adapters-v6.ts";

/** Feedback is derived only from public gates. JSON escapes preserve blank values. */
export function focusedPublicFeedback(t: CommonTask, gates: any[]) {
  const failures: any[] = [];
  for (const gate of gates) {
    if (!["baseline", "core", "challenge"].includes(gate.suite))
      throw Error("Non-public gate cannot enter repair feedback");
    if (gate.result.passed) continue;
    if (gate.suite === "baseline") {
      failures.push({
        suite: "baseline",
        originalTestsPassed: false,
        detail: gate.result.detail ?? null,
      });
      continue;
    }
    const probes = gate.suite === "core" ? t.core : t.challenge;
    const rows = gate.result.rows.filter((row: any) => row.passed === false);
    if (!rows.length)
      throw Error("Failed public gate lacks failed observations");
    const seen = new Set();
    for (const row of rows) {
      const probe = probes.find((p) => p.id === row.id);
      if (!probe || seen.has(row.id) || row.expected !== probe.expected)
        throw Error("Public failure does not match an exposed case");
      seen.add(row.id);
      failures.push({
        suite: gate.suite,
        id: row.id,
        input:
          "args" in probe
            ? { args: probe.args, options: probe.options }
            : { object: probe.object, path: probe.path },
        expectedJson: probe.expected,
        actualJson: row.actual ?? null,
        status: row.status,
      });
    }
  }
  return {
    format: "repolab-public-failure-feedback/v7",
    instruction:
      "Repair the failed public values below while retaining every other supplied public case and original test. JSON string escapes and whitespace are significant. Follow the supplied expression grammar; do not change tests or invent expected behavior.",
    failures,
  };
}
