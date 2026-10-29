import { readFileSync } from "node:fs";
import { z } from "zod";
import type { Execution, Gate } from "../contracts/index.ts";
import { sha256 } from "../evidence/hash.ts";
import { readRepositorySnapshot } from "./prepare.ts";
import { getQualificationPlan } from "./qualification.ts";

const lockHash =
  "05073bd678d69190ec1c7ec09dd1a66c7ea43e2b14d009d084b205c8455104af";
const templateHash =
  "12f979d919c3736259f96889740318322a9c75b1e7d939c7ba1f1caa608f6247";
const treeHash =
  "27b022e4dc56e475966f83e8d42ed07591a46e8426be16de10c008de3516da17";
const artifacts = ["dist/clsx.js", "dist/clsx.m.js", "dist/clsx.min.js"];
const testPaths = ["test/classnames.js", "test/index.js"];
const buildCommand = ["/usr/local/bin/npm", "run", "--ignore-scripts", "build"];
const regressionCommand = [
  "/usr/local/bin/node",
  "node_modules/tape/bin/tape",
  ...testPaths,
];
const Hash = z.string().regex(/^[a-f0-9]{64}$/);

function pinnedAsset(name: string, hash: string) {
  const content = readFileSync(
    new URL(`../../repositories/clsx-baseline/${name}`, import.meta.url),
    "utf8",
  );
  if (sha256(content) !== hash)
    throw new Error(`Baseline ${name} integrity mismatch`);
  return content;
}

/** Offline preparation only. Neither imports nor runs upstream/dependency code. */
export function getBaselinePlan(input: unknown) {
  const snapshot = readRepositorySnapshot(input);
  const qualification = getQualificationPlan(snapshot);
  const lock = pinnedAsset("package-lock.json", lockHash);
  const template = pinnedAsset("runner.mjs", templateHash);
  const tree = JSON.parse(pinnedAsset("tree.json", treeHash));
  if (
    tree.treeSha !== snapshot.treeSha ||
    JSON.stringify(
      tree.entries
        .filter(
          (e: { path: string; type: string }) =>
            e.type === "blob" && /^test\/.+\.js$/.test(e.path),
        )
        .map((e: { path: string }) => e.path)
        .sort(),
    ) !== JSON.stringify(testPaths)
  )
    throw new Error("Upstream test tree does not match the reviewed baseline");
  const dependencies = JSON.parse(lock) as {
    packages: Record<
      string,
      { version?: string; resolved?: string; integrity?: string }
    >;
  };
  const files = [
    ...snapshot.files.map(({ path, content, sha256 }) => ({
      path,
      content,
      sha256,
    })),
    { path: "package-lock.json", content: lock, sha256: lockHash },
  ];
  const groups = testPaths.flatMap((path) => {
    const source = snapshot.files.find((file) => file.path === path)!.content;
    // Only the exact reviewed test bytes are admitted; this is a catalogue, not a JS parser.
    const blocks = [...source.matchAll(/^test\('([^']+)', t => \{/gm)];
    return blocks.map((match, index) => ({
      path,
      name: match[1],
      assertions: [
        ...source
          .slice(match.index, blocks[index + 1]?.index)
          .matchAll(/\bt\.is\(/g),
      ].length,
    }));
  });
  const expectedAssertions = groups.reduce(
    (sum, group) => sum + group.assertions,
    0,
  );
  if (groups.length !== 24 || expectedAssertions !== 50)
    throw new Error("Unexpected static baseline catalogue");
  const config = {
    files: files.map(({ path, sha256 }) => ({ path, sha256 })),
    artifacts,
    testPaths,
    buildCommand,
    regressionCommand,
    groups,
    lockHash,
    templateHash,
    snapshotDigest: snapshot.digest,
  };
  const recipeDigest = sha256(JSON.stringify(config));
  const runner = template.replace(
    "/*REPOLAB_BASELINE_CONFIG*/ null",
    JSON.stringify({ ...config, recipeDigest }),
  );
  return {
    version: 1,
    profile: qualification.profile,
    scope: "unchanged-upstream-build-regression" as const,
    status: "PLANNED_NOT_EXECUTED" as const,
    qualified: false as const,
    snapshotDigest: snapshot.digest,
    repository: qualification.repository,
    commit: qualification.commit,
    sourceHash: qualification.sourceHash,
    recipeDigest,
    lockHash,
    templateHash,
    treeHash,
    dependencyCount: Object.keys(dependencies.packages).length - 1,
    directDependencies: Object.fromEntries(
      ["bundt", "tape", "tap-spec"].map((name) => [
        name,
        dependencies.packages[`node_modules/${name}`].version,
      ]),
    ),
    lockPreparation: {
      nodeVersion: "v24.18.0",
      npmVersion: "12.0.2",
      method:
        "npm install --package-lock-only --ignore-scripts --no-audit --no-fund",
      registry: "https://registry.npmjs.org",
      packagesInstalled: 0,
    },
    dependencySetup: {
      execution: "certified-isolated-image-preparation-only",
      cwd: "/opt/repolab/dependencies",
      inputs: ["package.json", "package-lock.json"],
      command: [
        "/usr/local/bin/npm",
        "ci",
        "--ignore-scripts",
        "--include=dev",
        "--no-audit",
        "--no-fund",
      ],
      networking:
        "registry access during dependency setup only; disabled during build/tests",
      environment:
        "allowlisted PATH/HOME/LANG/TZ and empty npm configuration; no provider credentials",
      requiredEvidence: [
        "Successful npm ci and lock integrity",
        "Installed dependency tree and runtime versions",
        "Root-owned read-only node_modules in an immutable certified image",
      ],
    },
    execution: {
      provider: "nebius-sandbox",
      cwd: "/tmp/repolab/upstream",
      uid: 1000,
      gid: 1000,
      networking: false,
      preserveEnv: false,
      runtime: "Node 24",
      command: ["/usr/local/bin/node", "/opt/repolab/baseline-runner.mjs"],
      buildCommand,
      regressionCommand,
      commandTimeoutSeconds: 10,
      operationTimeoutSeconds: 30,
      outputLimitBytes: 131072,
      streamLimitBytes: 16384,
      inputs:
        "root-owned read-only regular files; fresh writable workspace with no dist or alternate configs",
      dependencies:
        "node_modules supplied by the dependency-ready immutable image",
    },
    files,
    runner,
    runnerHash: sha256(runner),
    groups,
    expectedAssertions,
    expectedArtifacts: artifacts,
    license: qualification.license,
    provenance: { inference: "none", execution: "none" },
    inferenceCalls: 0,
    upstreamExecutions: 0,
    remainingGates: [
      "Certify dependency-ready isolation and image identity",
      "Execute unchanged original build and all 50 upstream assertions",
      "Reproduce reported failure twice and qualify independent reference/evaluator",
    ],
    limitation:
      "Prepared recipe and static assertion catalogue; no measured upstream baseline. Existing sandbox dispatch does not stage this recipe or provision its dependency image. TAP consistency checks do not prove resistance to hostile same-process forgery.",
  };
}

/** A narrow parser for the pinned flat Tape 4 output, not a general TAP parser. */
export function inspectBaselineTap(input: unknown, tap: string) {
  const plan = getBaselinePlan(input);
  const rows: { id: string; number: number; description: string }[] = [];
  const invalid = (reason: string) => ({
    valid: false,
    reason,
    assertions: rows,
  });
  if (Buffer.byteLength(tap) > 16384 || !tap.endsWith("\n"))
    return invalid("Missing complete bounded TAP output");
  const lines = tap
    .replaceAll("\r\n", "\n")
    .split("\n")
    .filter((line) => line !== "");
  if (lines.shift() !== "TAP version 13")
    return invalid("Missing TAP 13 header");
  let groupIndex = -1,
    groupCount = 0,
    ended = false;
  for (const line of lines) {
    if (line === `1..${plan.expectedAssertions}`) {
      if (
        ended ||
        rows.length !== plan.expectedAssertions ||
        groupIndex !== plan.groups.length - 1 ||
        groupCount !== plan.groups[groupIndex].assertions
      )
        return invalid("Incomplete, repeated or misplaced TAP plan");
      ended = true;
      continue;
    }
    if (ended) {
      // The exact complete Tape footer is validated below.
      continue;
    }
    if (line.startsWith("# ")) {
      if (groupIndex >= 0 && groupCount !== plan.groups[groupIndex].assertions)
        return invalid("Missing assertions from a test group");
      const group = plan.groups[++groupIndex];
      if (!group || line !== `# ${group.name}`)
        return invalid("Unknown, reordered, skipped or TODO test group");
      groupCount = 0;
      continue;
    }
    const match = /^ok ([1-9]\d*)(?: (.*))?$/.exec(line);
    if (
      !match ||
      match[2]?.includes("#") ||
      groupIndex < 0 ||
      Number(match[1]) !== rows.length + 1 ||
      groupCount >= plan.groups[groupIndex].assertions
    )
      return invalid("Failed, missing, duplicate or unexpected TAP assertion");
    const group = plan.groups[groupIndex];
    rows.push({
      id: `${group.path}::${group.name}::${++groupCount}`,
      number: Number(match[1]),
      description: match[2] ?? "",
    });
  }
  const footer = [
    `1..${plan.expectedAssertions}`,
    `# tests ${plan.expectedAssertions}`,
    `# pass  ${plan.expectedAssertions}`,
    "# ok",
  ];
  if (
    !ended ||
    JSON.stringify(lines.slice(-4)) !== JSON.stringify(footer) ||
    lines.indexOf(footer[0]) !== lines.length - 4
  )
    return invalid("Missing or inconsistent complete Tape footer");
  return {
    valid: true,
    reason: "All pinned upstream assertion identities collected",
    assertions: rows,
  };
}

const Step = z.strictObject({
  exitCode: z.number().int().nullable(),
  signal: z.string().nullable(),
  timedOut: z.boolean(),
  truncated: z.boolean(),
  error: z.string().nullable(),
  stdout: z.string().max(16384),
  stderr: z.string().max(16384),
});
const Result = z.strictObject({
  protocol: z.literal("repolab-upstream-baseline/v1"),
  recipeDigest: Hash,
  runtimeVersion: z.string(),
  before: z.record(z.string(), Hash),
  after: z.record(z.string(), Hash),
  artifacts: z
    .array(
      z.strictObject({
        path: z.string(),
        sha256: Hash,
        bytes: z.number().int().positive().max(32768),
      }),
    )
    .length(3),
  build: Step,
  regression: Step,
});

/** Checks recorded isolated evidence; never runs upstream JavaScript. */
export function checkBaselineExecution(
  input: unknown,
  execution: Execution,
): Gate {
  const plan = getBaselinePlan(input);
  const failed = (detail: string): Gate => ({
    name: "Unchanged upstream baseline",
    passed: false,
    detail,
  });
  if (
    execution.provider !== "nebius-sandbox" ||
    !z.uuid().safeParse(execution.operationId).success ||
    !z.uuid().safeParse(execution.image).success ||
    !z.uuid().safeParse(execution.id).success ||
    execution.sourceHash !== plan.sourceHash ||
    execution.testHash !== plan.runnerHash ||
    execution.exitCode !== 0 ||
    execution.signal ||
    execution.timedOut ||
    execution.truncated ||
    !/^v24\.\d+\.\d+$/.test(execution.runtimeVersion ?? "") ||
    Buffer.byteLength(execution.stdout) > 131072
  )
    return failed(
      "Complete isolated Node 24 execution with matching source/runner identities is required",
    );
  try {
    const result = Result.parse(JSON.parse(execution.stdout));
    if (
      result.recipeDigest !== plan.recipeDigest ||
      result.runtimeVersion !== execution.runtimeVersion
    )
      return failed("Recipe or runtime mismatch");
    const expectedHashes = Object.fromEntries(
      plan.files.map(({ path, sha256 }) => [path, sha256]),
    );
    for (const hashes of [result.before, result.after])
      if (
        Object.keys(hashes).length !== plan.files.length ||
        plan.files.some(
          (file) => hashes[file.path] !== expectedHashes[file.path],
        )
      )
        return failed(
          "Original source, tests, metadata, license or lock changed",
        );
    if (
      result.artifacts.some(
        (artifact, index) => artifact.path !== plan.expectedArtifacts[index],
      ) ||
      result.artifacts[1].sha256 !== plan.sourceHash
    )
      return failed("Missing build outputs or changed ESM artifact");
    for (const step of [result.build, result.regression])
      if (
        step.exitCode !== 0 ||
        step.signal ||
        step.error ||
        step.timedOut ||
        step.truncated
      )
        return failed(
          "Build and raw Tape processes must both complete successfully",
        );
    const tap = inspectBaselineTap(input, result.regression.stdout);
    if (!tap.valid) return failed(tap.reason);
    return {
      name: "Unchanged upstream baseline",
      passed: true,
      detail:
        "Original build and 50 upstream assertions match the pinned recipe; full case qualification remains separate",
    };
  } catch {
    return failed(
      "Baseline output is missing or does not match the evidence contract",
    );
  }
}
