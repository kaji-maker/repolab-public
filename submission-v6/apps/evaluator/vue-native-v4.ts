import { readFileSync, existsSync } from "node:fs";
import { mkdir, open, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import {
  auditVueNativeFreeze,
  verifyVueSourceArchive,
  vueNativeSlots,
  vueNativeRequest,
  vueNativeIntegrity,
  vueNativeObservations,
  checkedVueNativeSuite,
  parseVueNativeReceipt,
  VUE_NATIVE_IMAGE,
  VUE_NATIVE_FREEZE,
  VUE_NATIVE_COMMIT,
  VUE_NATIVE_TREE,
  VUE_NATIVE_PREVIOUS_FAILED_FREEZE,
  shaVueNative,
} from "../../packages/evaluation/vue-native-v4.ts";
import { VueNativeSandbox } from "../../packages/execution/vue-native-v4.ts";
import { acquireRepairLease } from "../../packages/repositories/repair-lease.ts";

const directory = ".repolab/vue-native-v4/run";

export function auditVueNativeRun(runDir = directory) {
  auditVueNativeFreeze();
  const archiveVerification = verifyVueSourceArchive();
  const ids = new Set<string>();
  let parent = VUE_NATIVE_IMAGE;
  const results: Record<string, ReturnType<typeof parseVueNativeReceipt>> = {};
  for (const slot of vueNativeSlots) {
    const r = JSON.parse(readFileSync(join(runDir, slot + ".json"), "utf8"));
    z.uuid().parse(r.id);
    if (ids.has(r.id)) throw Error("Duplicate Vue native operation");
    ids.add(r.id);
    if (
      r.slot !== slot ||
      r.inference !== "none" ||
      r.execution !== "nebius-sandbox"
    )
      throw Error("Vue native provenance changed");
    if (
      JSON.stringify(r.request) !==
      JSON.stringify(
        vueNativeRequest(
          slot,
          parent,
          slot === "prepare" ? r.request.files : {},
        ),
      )
    )
      throw Error("Vue native submitted recipe changed");
    if (slot === "prepare") {
      const mapping = [
        ["upstream.tar.gz", "repositories/vue-native-v1/original.tar.gz"],
        ["manifest.json", "fixtures/vue-native/original-manifest.json"],
        ["guest.cjs", "repositories/vue-native-v4/guest.cjs"],
        ["reproduction.cjs", "repositories/vue-native-v1/reproduction.cjs"],
      ];
      if (Object.keys(r.request.files).length !== 4)
        throw Error("Vue native uploads missing");
      for (const [target, source] of mapping) {
        const upload = JSON.parse(
          readFileSync(join(runDir, "upload-" + target + ".json"), "utf8"),
        );
        const f = r.request.files["/opt/repolab/native/" + target];
        if (
          upload.status !== "VERIFIED" ||
          upload.source !== source ||
          upload.sha256 !== shaVueNative(readFileSync(source)) ||
          upload.response.sha256 !== upload.sha256 ||
          upload.bytes !== readFileSync(source).length ||
          ![-1, upload.bytes].includes(upload.response.size) ||
          f.uuid !== upload.response.uuid ||
          f.uid !== 0 ||
          f.gid !== 0 ||
          f.mode !== "0444"
        )
          throw Error("Vue native uploaded file changed");
      }
    }
    results[slot] = parseVueNativeReceipt(r.latest, slot, r.id, parent);
    if (["prepare", "build", "protect"].includes(slot))
      parent = results[slot].op.result_image_uuid!;
  }
  const pnpmVersion = results.prepare.guest.commands[2]?.stdout.trim();
  if (pnpmVersion !== "9.10.0")
    throw Error("Installed pnpm version mismatch: " + pnpmVersion);
  const builtCjs = z
    .object({
      sha256: z.string().regex(/^[a-f0-9]{64}$/),
      bytes: z.number().int().positive(),
    })
    .parse(results.build.guest.compilerSfcCjs);
  if (
    !Array.isArray(results.build.guest.buildChangedOriginalPaths) ||
    results.build.guest.buildChangedOriginalPaths.length !== 0
  )
    throw Error("Vue native build modified tracked original files");
  vueNativeIntegrity(results.integrity.guest);
  const unitA = checkedVueNativeSuite(results["unit-A"].guest.unit);
  const unitB = checkedVueNativeSuite(results["unit-B"].guest.unit);
  if (unitA.caseDigest !== unitB.caseDigest)
    throw Error("Vue native repeated unit case identities changed");
  const obsA = vueNativeObservations(
    results["reproduction-A"].guest.observations,
  );
  const obsB = vueNativeObservations(
    results["reproduction-B"].guest.observations,
  );
  if (!isDeepStrictEqual(obsA, obsB))
    throw Error("Vue native repeated reproduction observations changed");
  return {
    format: "repolab-vue-native-result/v4",
    freeze: VUE_NATIVE_FREEZE,
    status: "QUALIFIED_NATIVE_BASELINE",
    taskId: "vuejs__core-11899",
    baseCommit: VUE_NATIVE_COMMIT,
    gitTreeSha1: VUE_NATIVE_TREE,
    classification: "bug-regression",
    previousFailedAttempts: [
      {
        attempt: "v1",
        freeze: "79b717f98fb54230eb9cfe13c4ff1c65f91896a3f1f1563767da109d6cbdefff",
        operationIds: ["01a1429b-a8e8-7175-9ad9-cc3acaf687b4"],
        status: "PREPARE_FAILED_EXECUTION_BLOCKER",
        unrunSlots: 7,
      },
      {
        attempt: "v2",
        freeze: "8b49eaa11b0ba5b1fb0bbe57a875d6bc9325972d5fdb5f366eff919eea9c4675",
        operationIds: [
          "01a142a8-9570-7352-8ba2-560b7baf5508",
          "01a142a8-f3b1-72c5-8b3b-2fe80cba483b",
          "01a142a9-17ee-77b3-8252-8464bf6f77a3",
          "01a142a9-1f1f-7638-853c-b33a10d385af",
          "01a142a9-2693-727d-8c2f-4c3acc6664b6",
        ],
        status: "UNIT_FAILED_EXECUTION_BLOCKER",
        unrunSlots: 3,
      },
      {
        attempt: "v3",
        freeze: VUE_NATIVE_PREVIOUS_FAILED_FREEZE,
        operationIds: [
          "01a142b2-0932-73c1-bf7c-c96450d239aa",
          "01a142b2-6cf8-77ec-97e2-bd8861d2da83",
          "01a142b2-8c7f-7189-ad80-2c3a8890f81a",
          "01a142b2-93c5-71ab-b5f6-2ad318528744",
          "01a142b2-9acc-71f0-85fe-749b045ee60c",
        ],
        status: "UNIT_ASSERTION_BLOCKER",
        unrunSlots: 3,
      },
    ],
    operationIds: [...ids],
    protectedImage: parent,
    inference: "none",
    execution: "nebius-sandbox",
    inferenceCalls: 0,
    modelAttempts: 0,
    modelAdmission: false,
    archiveVerification,
    pnpmVersion,
    runtime: "v20.9.0",
    upstreamRuntime: "20",
    compilerSfcCjs: builtCjs,
    nativeBuildChangedOriginalPaths:
      results.build.guest.buildChangedOriginalPaths,
    unit: unitA,
    observations: obsA,
    denominator: {
      selectedExternalTasks: 3,
      selectedTaskIds: [
        "facebook__docusaurus-8927",
        "preactjs__preact-4436",
        "vuejs__core-11899",
      ],
      docusaurusStatus: "UNSUPPORTED_RETAINED_IN_DENOMINATOR",
      nativeBaselineQualifiedTaskIds: [
        "preactjs__preact-4436",
        "vuejs__core-11899",
      ],
      nativeBaselineQualifiedTasks: 2,
      repairQualifiedTasks: 0,
      attemptedModelTasks: 0,
      exposedDevelopmentControls: ["regexparam"],
    },
  };
}

async function main() {
  const action = process.argv[2] ?? "plan";
  auditVueNativeFreeze();
  const sourceSummary = verifyVueSourceArchive();
  if (action === "plan") {
    console.log(
      JSON.stringify(
        {
          freeze: VUE_NATIVE_FREEZE,
          slots: vueNativeSlots,
          inferenceCalls: 0,
          modelAdmission: false,
          execution: "none; planning only",
          sourceVerification: sourceSummary,
          docusaurusStatus: "UNSUPPORTED_RETAINED_IN_DENOMINATOR",
          selectedExternalDenominator: 3,
        },
        null,
        2,
      ),
    );
    return;
  }
  if (action === "audit") {
    const r = auditVueNativeRun();
    console.log(
      JSON.stringify(
        {
          ...r,
          unit: { ...r.unit, cases: undefined },
        },
        null,
        2,
      ),
    );
    return;
  }
  if (action !== "run") throw Error("Use plan, run or audit");
  if (existsSync(join(directory, "STARTED.json")))
    throw Error(
      "Vue native fixed run already started; inspect retained evidence, no rerun",
    );
  const release = await acquireRepairLease(".repolab", "vue-native-v4");
  try {
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const f = await open(join(directory, "STARTED.json"), "wx", 0o600);
    await f.writeFile(
      JSON.stringify({
        freeze: VUE_NATIVE_FREEZE,
        startedAt: new Date().toISOString(),
        inference: "none",
        execution: "nebius-sandbox",
      }),
    );
    await f.close();
    const client = new VueNativeSandbox(directory);
    await client.upload();
    let image = VUE_NATIVE_IMAGE;
    for (const slot of vueNativeSlots) {
      console.log(
        JSON.stringify({
          slot,
          status: "STARTING",
          inference: "none",
          execution: "nebius-sandbox",
        }),
      );
      const result = await client.run(slot, image);
      if (["prepare", "build", "protect"].includes(slot))
        image = result.op.result_image_uuid!;
      if (slot === "integrity") vueNativeIntegrity(result.guest);
      if (slot.startsWith("reproduction"))
        vueNativeObservations(result.guest.observations);
      if (slot.startsWith("unit")) checkedVueNativeSuite(result.guest.unit);
      console.log(
        JSON.stringify({
          slot,
          status: "COMPLETED",
          operationId: result.op.uuid,
        }),
      );
    }
    const result = auditVueNativeRun();
    await writeFile(
      join(directory, "result.json"),
      JSON.stringify(result, null, 2) + "\n",
      { mode: 0o600 },
    );
    console.log(
      JSON.stringify(
        {
          ...result,
          unit: { ...result.unit, cases: undefined },
        },
        null,
        2,
      ),
    );
  } finally {
    await release();
  }
}

if (process.argv[1]?.endsWith("apps/evaluator/vue-native-v4.ts"))
  main().catch((e) => {
    console.error(
      e instanceof Error ? e.message : "Vue native qualification failed",
    );
    process.exitCode = 1;
  });
