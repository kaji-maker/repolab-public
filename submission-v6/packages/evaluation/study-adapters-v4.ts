import { readFileSync } from "node:fs";
import { z } from "zod";
import { sha256 } from "../evidence/hash.ts";
import { extractExplicitContract } from "../providers/fixture.ts";
import { studyTask } from "./study-tasks.ts";
import { studyOracle } from "./study-oracle.ts";
import { observationSpec, stageStudyCandidate } from "./study-execution.ts";
import type { StudyRemote, StudyRunSpec } from "./study-execution.ts";
import { checkedObservation } from "./study-observation-v3.ts";
import {
  pilotTask,
  pilotCore,
  pilotControls,
  oraclePilot,
  baselinePilotSpec,
  checkPilotBaseline,
  observationPilotSpec,
  checkPilotObservation,
  checkPilotExecution,
} from "./github-pilot-v2.ts";
import {
  dsetTask,
  dsetCases,
  dsetBaselineSpec,
  checkDsetTap,
} from "./dset-qualification.ts";
import {
  mriTask,
  mriCases,
  mriBaselineSpec,
  checkMriTap,
} from "./mri-qualification-v3.ts";
import {
  unrunControlCases,
  assessUnrunControlReport,
  unrunControlSpec,
  checkUnrunControlObservation,
} from "./unrun-controls.ts";
import { assertCommonSource } from "./study-policy-v4.ts";

export const commonTaskIds = [
  "refund-missing-facts",
  "shipping-already-correct",
  "booking-timezone",
  "checkout-quantity",
  "clsx-object-push",
  "dlv-null-path",
  "dset-decimal-path",
  "mri-zero-number",
] as const;
export type CommonTaskId = (typeof commonTaskIds)[number];
export type CommonArm = "A" | "B" | "C";
export type CommonSuite = "baseline" | "core" | "challenge" | "independent";
export interface CommonTask {
  id: CommonTaskId;
  kind: "bug" | "already-correct" | "missing-facts";
  origin: string;
  path: string;
  source: string;
  report: string;
  baselinePublic: unknown;
  core: any[];
  challenge: any[];
}
const legacy = (id: string) =>
  ["booking-timezone", "checkout-quantity", "clsx-object-push"].includes(id);
export function commonTask(id: CommonTaskId): CommonTask {
  if (legacy(id)) {
    const t = studyTask(id as any),
      c = extractExplicitContract(t.report, id as any);
    if (!c) throw Error("Frozen complete report lost facts");
    const rows = c.expectations.map(({ sourceQuote, ...p }: any) => p);
    return {
      id,
      kind: "bug",
      origin: "exposed-development",
      path: t.path,
      source: t.source,
      report: t.report,
      baselinePublic: t.baselineTests,
      core: rows.slice(0, 1),
      challenge: rows.slice(1),
    };
  }
  if (id === "dlv-null-path") {
    const t = pilotTask();
    return {
      id,
      kind: "bug",
      origin: "exposed-public-historical",
      path: "index.js",
      source: t.source,
      report: t.report,
      baselinePublic: t.test,
      core: pilotCore,
      challenge: pilotControls,
    };
  }
  if (id === "dset-decimal-path") {
    const t = dsetTask(),
      c = dsetCases().cases;
    return {
      id,
      kind: "bug",
      origin: "model-unrun-public-historical-authored-oracle",
      path: "src/index.js",
      source: t.source,
      report: t.report,
      baselinePublic: t.snapshot.files
        .filter((f) => f.role === "baseline")
        .map((f) => ({ path: f.path, content: f.content })),
      core: c.slice(0, 1),
      challenge: c.slice(1, 2),
    };
  }
  if (id === "mri-zero-number") {
    const t = mriTask(),
      c = mriCases().cases;
    return {
      id,
      kind: "bug",
      origin: "model-unrun-public-historical-authored-oracle",
      path: "lib/index.js",
      source: t.source,
      report: t.report,
      baselinePublic: t.snapshot.files
        .filter((f) => f.role === "baseline")
        .map((f) => ({ path: f.path, content: f.content })),
      core: c.slice(0, 1),
      challenge: [c[1], c[4], c[11]],
    };
  }
  const c = unrunControlCases().tasks.find((t) => t.id === id);
  if (!c) throw Error("Unknown common task");
  return {
    id,
    kind: c.kind,
    origin: "model-unrun-authored-control",
    path: c.source,
    source: readFileSync(c.source, "utf8"),
    report: JSON.stringify(c.report),
    baselinePublic: null,
    core: [],
    challenge: [],
  };
}
function inputIdentity(p: any) {
  const { id, expected, sourceQuote, description, ...input } = p;
  return JSON.stringify(input);
}
/** Controller only. Called after an immutable decision is written; never included in inference context. */
export function commonIndependent(id: CommonTaskId) {
  const t = commonTask(id),
    excluded = new Set([...t.core, ...t.challenge].map(inputIdentity));
  const rows = legacy(id)
    ? studyOracle(id as any).cases
    : id === "dlv-null-path"
      ? oraclePilot().cases
      : id === "dset-decimal-path"
        ? dsetCases().cases
        : id === "mri-zero-number"
          ? mriCases().cases
          : [];
  const result = rows.filter((p) => !excluded.has(inputIdentity(p)));
  if (t.kind === "bug" && !result.length)
    throw Error("Independent suite is empty");
  return result;
}
export function commonContractSchema(t: CommonTask) {
  const rows = legacy(t.id) ? [...t.core, ...t.challenge] : t.core;
  if (!rows.length) throw Error("Controls require no model contract");
  return z.strictObject({
    task: z.literal(t.id),
    reportQuote: z.literal(t.report),
    examples: z
      .array(
        z.strictObject({
          id: z.enum(rows.map((p) => p.id)),
          inputHash: z.enum(rows.map((p) => sha256(inputIdentity(p)))),
          expectedJson: z.enum(rows.map((p) => JSON.stringify(p.expected))),
        }),
      )
      .length(rows.length),
  });
}
export function commonFactsPacket(t: CommonTask) {
  const rows = legacy(t.id) ? [...t.core, ...t.challenge] : t.core;
  return {
    task: t.id,
    report: t.report,
    examples: rows.map((p) => ({
      id: p.id,
      input: JSON.parse(inputIdentity(p)),
      inputHash: sha256(inputIdentity(p)),
      expectedJson: JSON.stringify(p.expected),
    })),
  };
}
export function checkCommonContract(t: CommonTask, input: unknown) {
  const c = commonContractSchema(t).parse(input),
    rows = legacy(t.id) ? [...t.core, ...t.challenge] : t.core;
  if (
    new Set(c.examples.map((p) => p.id)).size !== rows.length ||
    c.examples.some((p) => {
      const exact = rows.find((r) => r.id === p.id);
      return (
        !exact ||
        p.inputHash !== sha256(inputIdentity(exact)) ||
        p.expectedJson !== JSON.stringify(exact.expected)
      );
    })
  )
    throw Error("Ungrounded or omitted report expectation");
  return c;
}
export function commonSuites(arm: CommonArm, hasChallenge: boolean) {
  return arm === "A"
    ? ["baseline"]
    : arm === "B"
      ? ["baseline", "core"]
      : [
          "baseline",
          "core",
          ...(hasChallenge ? ["challenge"] : []),
          "core",
          "baseline",
        ];
}
export function commonObservationSpec(
  t: CommonTask,
  source: string,
  probes: any[],
): StudyRunSpec {
  assertCommonSource(t.id, t.source, source);
  if (legacy(t.id)) return observationSpec(t.id as any, t.path, source, probes);
  if (t.id === "dlv-null-path") return observationPilotSpec(source, probes);
  const isDset = t.id === "dset-decimal-path";
  if (!isDset && t.id !== "mri-zero-number")
    throw Error("Unsupported observation task");
  const path = isDset
    ? "/tmp/repolab/dset-module.mjs"
    : "/tmp/repolab/mri-module.cjs";
  const input = probes.map(({ expected, ...p }) => p);
  const template = readFileSync(
    isDset
      ? "repositories/dset-qualification/observer.mjs"
      : "repositories/mri-qualification/observer.mjs",
    "utf8",
  );
  if (template.split("__PROBES__").length !== 2)
    throw Error("Observer changed");
  const tests = template.replace("__PROBES__", JSON.stringify(input));
  return {
    phase: "observations",
    sourceHash: sha256(source),
    testHash: sha256(tests),
    files: [
      { path, content: source },
      { path: "/tmp/repolab/test.mjs", content: tests },
    ],
  };
}
export function checkCommonObservation(
  t: CommonTask,
  source: string,
  probes: any[],
  e: any,
  image: string,
) {
  const spec = commonObservationSpec(t, source, probes);
  checkPilotExecution(e, spec, image);
  if (legacy(t.id)) {
    const result = checkedObservation(e, spec, image, probes);
    if (!result.valid) throw Error("Incomplete observation");
    return result.rows;
  }
  if (t.id === "dlv-null-path")
    return checkPilotObservation(e, source, image, probes);
  const body = z
    .strictObject({
      protocol: z.literal(
        t.id === "dset-decimal-path"
          ? "repolab-dset-observations/v1"
          : "repolab-mri-observations/v1",
      ),
      runtimeVersion: z.literal("v24.18.0"),
      observations: z
        .array(
          z.union([
            z.strictObject({
              id: z.string(),
              status: z.literal("returned"),
              actual: z.string().max(16000),
            }),
            z.strictObject({ id: z.string(), status: z.literal("threw") }),
          ]),
        )
        .min(1)
        .max(32),
    })
    .parse(JSON.parse(e.stdout));
  if (
    body.observations.length !== probes.length ||
    new Set(body.observations.map((p) => p.id)).size !== probes.length ||
    e.exitCode !== (body.observations.some((p) => p.status === "threw") ? 1 : 0)
  )
    throw Error("Incomplete or inconsistent observations");
  return probes.map((p) => {
    const o = body.observations.find((o) => o.id === p.id);
    if (!o) throw Error("Missing observation");
    return {
      id: p.id,
      status: o.status,
      actual: o.status === "returned" ? o.actual : null,
      expected: p.expected,
      passed: o.status === "returned" && o.actual === p.expected,
    };
  });
}
export function commonHistoricalBaselineSpec(
  t: CommonTask,
  source: string,
): StudyRunSpec {
  assertCommonSource(t.id, t.source, source);
  if (t.id === "dlv-null-path") return baselinePilotSpec(source);
  const d = t.id === "dset-decimal-path";
  if (!d && t.id !== "mri-zero-number")
    throw Error("Not a direct historical baseline");
  const original = d
    ? dsetBaselineSpec("original")
    : mriBaselineSpec("original");
  const files = original.files.slice(0, -1).map((f) => ({ ...f }));
  const sourcePath = d
    ? "/tmp/repolab/dset/src/index.js"
    : "/tmp/repolab/mri/lib/index.js";
  files.find((f) => f.path === sourcePath)!.content = source;
  if (d)
    files.find((f) => f.path === "/tmp/repolab/dset/dist/dset.js")!.content =
      "module.exports = " + source.slice("export default ".length);
  const inputs = Object.fromEntries(
    files.map((f) => [f.path, sha256(f.content)]),
  );
  const runner = readFileSync(
    d
      ? "repositories/dset-qualification/baseline-runner.mjs"
      : "repositories/mri-qualification/baseline-runner.mjs",
    "utf8",
  ).replace("__INPUTS__", JSON.stringify(inputs));
  files.push({ path: "/opt/repolab/baseline-runner.mjs", content: runner });
  return {
    phase: "baseline",
    files,
    sourceHash: sha256(source),
    testHash: sha256(JSON.stringify(files)),
  };
}
export function checkCommonHistoricalBaseline(
  t: CommonTask,
  source: string,
  e: any,
  image: string,
) {
  if (t.id === "dlv-null-path") return checkPilotBaseline(e, source, image);
  const spec = commonHistoricalBaselineSpec(t, source);
  checkPilotExecution(e, spec, image);
  const d = t.id === "dset-decimal-path";
  const body = z
    .strictObject({
      protocol: z.literal(
        d ? "repolab-dset-upstream/v1" : "repolab-mri-upstream/v1",
      ),
      runtimeVersion: z.literal("v24.18.0"),
      ...(d
        ? {
            adapter: z.literal(
              "exact-export-default-prefix-to-commonjs-assignment/v1",
            ),
          }
        : { recipe: z.literal("original-commonjs-two-files-tape-cli/v1") }),
      protectedInputs: z.literal(true),
      protectedDirectories: z.literal(true),
      dependencyCount: z.literal(173),
      tapeVersion: z.literal("4.17.0"),
      controls: z
        .array(z.strictObject({ name: z.string(), denied: z.literal(true) }))
        .length(9),
      before: z.record(z.string(), z.string()),
      after: z.record(z.string(), z.string()),
      child: z.strictObject({
        exitCode: z.number().int(),
        signal: z.null(),
        error: z.null(),
        stdout: z.string().max(50000),
        stderr: z.string().max(16000),
      }),
    })
    .parse(JSON.parse(e.stdout));
  const hashes = Object.fromEntries(
    spec.files.slice(0, -1).map((f) => [f.path, sha256(f.content)]),
  );
  const names = [
    "write-source",
    "write-test",
    d ? "write-adapter" : "write-unknown-test",
    "write-metadata",
    "write-lock",
    "unlink-source",
    "rename-source",
    "chmod-source",
    "create-module",
  ];
  if (
    e.exitCode !== 0 ||
    JSON.stringify(body.before) !== JSON.stringify(hashes) ||
    JSON.stringify(body.after) !== JSON.stringify(hashes) ||
    body.controls.some((c, i) => c.name !== names[i])
  )
    throw Error("Historical baseline integrity changed");
  // Only a complete exact original TAP success can accept. Retained child failures reject the proposal.
  if (body.child.exitCode !== 0)
    return {
      passed: false,
      assertionCount: null,
      filesystemDenials: 9,
      detail: "Original upstream child failed; full raw output retained",
    };
  return {
    ...(d ? checkDsetTap(body.child.stdout) : checkMriTap(body.child.stdout)),
    filesystemDenials: 9,
  };
}
export function missingControlAssessment() {
  const t = unrunControlCases().tasks[1];
  return assessUnrunControlReport(t.id, t.report);
}
export async function evaluateCommon(
  t: CommonTask,
  source: string,
  suite: CommonSuite,
  image: string,
  run: StudyRemote,
  treeDigest?: string,
) {
  assertCommonSource(t.id, t.source, source);
  if (suite === "baseline") {
    if (t.id === "clsx-object-push") {
      if (!treeDigest) throw Error("Certified dependency tree required");
      const stage = await stageStudyCandidate(source, treeDigest, image, run);
      const result = await stage.baseline();
      return {
        passed: stage.gates.every((g) => g.passed) && result.passed,
        rows: null,
        detail: result,
      };
    }
    if (!legacy(t.id)) {
      const spec = commonHistoricalBaselineSpec(t, source),
        out = await run(image, spec);
      const result = checkCommonHistoricalBaseline(
        t,
        source,
        out.execution,
        image,
      );
      return { passed: result.passed, rows: null, detail: result };
    }
  }
  const probes =
    suite === "baseline"
      ? studyTask(t.id as any).baseline
      : suite === "core"
        ? t.core
        : suite === "challenge"
          ? t.challenge
          : commonIndependent(t.id);
  const spec = commonObservationSpec(t, source, probes),
    out = await run(image, spec);
  const rows = checkCommonObservation(t, source, probes, out.execution, image);
  return { passed: rows.every((p) => p.passed), rows, detail: null };
}
export async function evaluateAlreadyCorrect(image: string, run: StudyRemote) {
  const results = [];
  for (const scope of ["baseline", "report", "report", "controls"] as const) {
    const spec = unrunControlSpec(scope),
      out = await run(image, spec);
    results.push(checkUnrunControlObservation(out.execution, scope, image));
  }
  return {
    passed:
      results.every((r) => r.every((x) => x.passed)) &&
      JSON.stringify(results[1]) === JSON.stringify(results[2]),
    rows: results,
  };
}
