import { z } from "zod";
import { readFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Execution } from "../contracts/index.ts";
import type { TestProbe } from "../controller/tests.ts";
import type { StudyRunSpec } from "./study-execution.ts";
import { auditStudy as auditPreviousStudy } from "./study-protocol-v2.ts";
import { sha256 } from "../evidence/hash.ts";
import { studyTask } from "./study-tasks.ts";
import { studyOracle } from "./study-oracle.ts";
import { observationSpec } from "./study-execution.ts";
export {
  studyRemote,
  observationSpec,
  stageStudyCandidate,
} from "./study-execution.ts";
export type { StudyRemote } from "./study-execution.ts";
const Value = z.union([
  z.string().max(4000),
  z.number().finite().min(-1e9).max(1e9),
]);
const Body = z.strictObject({
  protocol: z.literal("repolab-observations/v1"),
  runtimeVersion: z.literal("v24.18.0"),
  observations: z
    .array(
      z.union([
        z.strictObject({
          id: z.string().max(64),
          status: z.literal("returned"),
          actual: Value,
        }),
        z.strictObject({
          id: z.string().max(64),
          status: z.enum(["threw", "unsupported"]),
        }),
      ]),
    )
    .min(1)
    .max(32),
});
export interface BehavioralRow {
  id: string;
  status: "returned" | "threw" | "unsupported";
  actual: string | number | null;
  expected: string | number;
  passed: boolean;
}
export function checkedObservation(
  out: Execution,
  spec: StudyRunSpec,
  image: string,
  probes: TestProbe[],
): { valid: boolean; rows: BehavioralRow[]; error?: string } {
  const invalid = (error: string) => ({ valid: false, rows: [], error });
  if (
    out.provider !== "nebius-sandbox" ||
    out.image !== image ||
    out.runtimeVersion !== "v24.18.0" ||
    !z.uuid().safeParse(out.id).success ||
    !z.uuid().safeParse(out.operationId).success ||
    out.sourceHash !== spec.sourceHash ||
    out.testHash !== spec.testHash
  )
    return invalid("Observation provenance mismatch");
  if (
    !probes.length ||
    probes.length > 32 ||
    new Set(probes.map((p) => p.id)).size !== probes.length ||
    probes.some(
      (p) =>
        !Value.safeParse(p.expected).success ||
        !/^[a-z][a-z0-9-]{0,63}$/.test(p.id),
    )
  )
    return invalid("Invalid controller expectations");
  if (
    out.timedOut !== false ||
    out.truncated !== false ||
    out.signal !== null ||
    ![0, 1].includes(out.exitCode!) ||
    Buffer.byteLength(out.stdout) > 16384
  )
    return invalid("Execution evidence incomplete");
  try {
    const body = Body.parse(JSON.parse(out.stdout));
    if (
      body.observations.length !== probes.length ||
      new Set(body.observations.map((o) => o.id)).size !== probes.length
    )
      return invalid("Incomplete or duplicate observations");
    const failed = body.observations.some((o) => o.status !== "returned");
    if (out.exitCode !== (failed ? 1 : 0))
      return invalid("Observer exit inconsistent with statuses");
    const rows = probes.map((p) => {
      const o = body.observations.find((o) => o.id === p.id);
      if (!o) throw Error();
      return {
        id: p.id,
        status: o.status,
        actual: o.status === "returned" ? o.actual : null,
        expected: p.expected,
        passed: o.status === "returned" && o.actual === p.expected,
      };
    });
    return { valid: true, rows };
  } catch {
    return invalid("Malformed or unsupported observation evidence");
  }
}
export function exceptionFixture() {
  return readFileSync("fixtures/study-v3-exception.mjs", "utf8");
}
/** Diagnostic interpretation only: never replace the previous frozen aggregate. */
export async function diagnosePriorException() {
  const p = auditPreviousStudy(),
    path = join(".repolab/studies", p.digest, "booking-timezone-A.json"),
    r = JSON.parse(await readFile(path, "utf8"));
  if (
    r.studyDigest !== p.digest ||
    r.task !== "booking-timezone" ||
    r.arm !== "A" ||
    !r.decision ||
    !r.completedAt
  )
    throw Error("Prior identity mismatch");
  const bytes = await readFile(r.decision.path, "utf8");
  if (
    sha256(bytes) !== r.decision.sha256 ||
    bytes !== JSON.stringify(r.decision.payload, null, 2) + "\n" ||
    r.decision.payload.at > r.independentOpenedAt
  )
    throw Error("Prior decision mismatch");
  const source = r.decision.payload.source,
    t = studyTask("booking-timezone"),
    cases = studyOracle(t.id).cases,
    e = r.executions.at(-1);
  if (
    typeof source !== "string" ||
    sha256(source) !== r.decision.payload.sourceHash
  )
    throw Error("Prior selection mismatch");
  const result = checkedObservation(
    e,
    observationSpec(t.id, t.path, source, cases),
    e.image,
    cases,
  );
  return {
    format: "repolab-retrospective-exception-diagnosis/v3",
    priorStudyDigest: p.digest,
    runId: r.id,
    priorFrozenStatus: r.status,
    priorFrozenCorrect: r.correct,
    newInterpretation: {
      valid: result.valid,
      passed: result.valid ? result.rows.filter((p) => p.passed).length : null,
      total: cases.length,
      exceptions: result.rows.filter((p) => p.status === "threw").length,
      acceptedAndIncorrect:
        r.accepted && result.valid && result.rows.some((p) => !p.passed),
    },
    previousRecordUnchanged: true,
    provenance: {
      inference: "none; prior actual model evidence",
      execution: "none; prior actual sandbox observations inspected",
    },
  };
}
