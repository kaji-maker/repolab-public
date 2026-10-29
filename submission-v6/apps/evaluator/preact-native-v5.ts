import { readFileSync, existsSync } from "node:fs";
import { mkdir, open, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import {
  auditNativeFreeze,
  nativeSlots,
  nativeRequest,
  nativeIntegrity,
  nativeObservations,
  checkedNativeSuite,
  nativeTypeCounts,
  parseNativeReceipt,
  NATIVE_IMAGE,
  NATIVE_FREEZE,
  shaNative,
  type NativeSlot,
} from "../../packages/evaluation/preact-native-v5.ts";
import { PreactNativeSandbox } from "../../packages/execution/preact-native-v5.ts";
import { acquireRepairLease } from "../../packages/repositories/repair-lease.ts";

const directory = ".repolab/preact-native-v5/run";
export function auditNativeRun() {
  auditNativeFreeze();
  const ids = new Set<string>();
  let parent = NATIVE_IMAGE;
  const results: Record<string, ReturnType<typeof parseNativeReceipt>> = {};
  for (const slot of nativeSlots) {
    const r = JSON.parse(readFileSync(join(directory, slot + ".json"), "utf8"));
    z.uuid().parse(r.id);
    if (ids.has(r.id)) throw Error("Duplicate native operation");
    ids.add(r.id);
    if (
      r.slot !== slot ||
      r.inference !== "none" ||
      r.execution !== "nebius-sandbox"
    )
      throw Error("Native provenance changed");
    if (
      JSON.stringify(r.request) !==
      JSON.stringify(
        nativeRequest(slot, parent, slot === "prepare" ? r.request.files : {}),
      )
    )
      throw Error("Native submitted recipe changed");
    if (slot === "prepare") {
      const mapping = [
        ["upstream.tar.gz", "repositories/preact-native-v1/original.tar.gz"],
        ["manifest.json", "fixtures/preact-native/original-manifest.json"],
        ["guest.cjs", "repositories/preact-native-v3/guest.cjs"],
        ["karma.cjs", "repositories/preact-native-v5/karma.cjs"],
        [
          "reproduction.html",
          "repositories/preact-native-v1/reproduction.html",
        ],
      ];
      if (Object.keys(r.request.files).length !== 5)
        throw Error("Native uploads missing");
      for (const [target, source] of mapping) {
        const upload = JSON.parse(
          readFileSync(join(directory, "upload-" + target + ".json"), "utf8"),
        );
        const f = r.request.files["/opt/repolab/native/" + target];
        if (
          upload.status !== "VERIFIED" ||
          upload.source !== source ||
          upload.sha256 !== shaNative(readFileSync(source)) ||
          upload.response.sha256 !== upload.sha256 ||
          upload.bytes !== readFileSync(source).length ||
          ![-1, upload.bytes].includes(upload.response.size) ||
          f.uuid !== upload.response.uuid ||
          f.uid !== 0 ||
          f.gid !== 0 ||
          f.mode !== "0444"
        )
          throw Error("Native uploaded file changed");
      }
    }
    results[slot] = parseNativeReceipt(r.latest, slot, r.id, parent);
    if (["prepare", "build", "protect"].includes(slot))
      parent = results[slot].op.result_image_uuid!;
  }
  nativeIntegrity(results.integrity.guest);
  const types = nativeTypeCounts(results.types.guest.commands[0].stdout);
  const mocha = checkedNativeSuite(results["mocha-A"].guest.mocha, "mocha");
  const browser = checkedNativeSuite(
    results["browser-A"].guest.browser,
    "browser",
  );
  if (
    mocha.caseDigest !==
      checkedNativeSuite(results["mocha-B"].guest.mocha, "mocha").caseDigest ||
    browser.caseDigest !==
      checkedNativeSuite(results["browser-B"].guest.browser, "browser")
        .caseDigest
  )
    throw Error("Native repeated case identities changed");
  nativeObservations(results["reproduction-A"].guest.observations);
  nativeObservations(results["reproduction-B"].guest.observations);
  return {
    format: "repolab-preact-native-result/v5",
    freeze: NATIVE_FREEZE,
    status: "QUALIFIED_NATIVE_BASELINE",
    taskId: "preactjs__preact-4436",
    classification: "feature-request",
    operationIds: [...ids],
    protectedImage: parent,
    inference: "none",
    execution: "nebius-sandbox",
    inferenceCalls: 0,
    modelAttempts: 0,
    modelAdmission: false,
    mocha,
    browser,
    types,
    observations: results["reproduction-A"].guest.observations,
    chromium: results.prepare.guest.commands.at(-1)?.stdout.trim(),
    runtime: "v20.9.0",
    upstreamRuntime: "20.9.0",
    nativeBuildChangedOriginalPaths:
      results.build.guest.buildChangedOriginalPaths,
  };
}
async function main() {
  const action = process.argv[2] ?? "plan";
  auditNativeFreeze();
  if (action === "plan") {
    console.log(
      JSON.stringify(
        {
          freeze: NATIVE_FREEZE,
          slots: nativeSlots,
          inferenceCalls: 0,
          modelAdmission: false,
          execution: "none; planning only",
        },
        null,
        2,
      ),
    );
    return;
  }
  if (action === "audit") {
    console.log(JSON.stringify(auditNativeRun(), null, 2));
    return;
  }
  if (action !== "run") throw Error("Use plan, run or audit");
  if (existsSync(join(directory, "STARTED.json")))
    throw Error(
      "Native fixed run already started; inspect retained evidence, no rerun",
    );
  const release = await acquireRepairLease(".repolab", "preact-native-v5");
  try {
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const f = await open(join(directory, "STARTED.json"), "wx", 0o600);
    await f.writeFile(
      JSON.stringify({
        freeze: NATIVE_FREEZE,
        startedAt: new Date().toISOString(),
        inference: "none",
        execution: "nebius-sandbox",
      }),
    );
    await f.close();
    const client = new PreactNativeSandbox(directory);
    await client.upload();
    let image = NATIVE_IMAGE;
    for (const slot of nativeSlots) {
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
      if (slot === "integrity") nativeIntegrity(result.guest);
      if (slot.startsWith("reproduction"))
        nativeObservations(result.guest.observations);
      if (slot === "types") nativeTypeCounts(result.guest.commands[0].stdout);
      if (slot.startsWith("mocha"))
        checkedNativeSuite(result.guest.mocha, "mocha");
      if (slot.startsWith("browser"))
        checkedNativeSuite(result.guest.browser, "browser");
      console.log(
        JSON.stringify({
          slot,
          status: "COMPLETED",
          operationId: result.op.uuid,
        }),
      );
    }
    const result = auditNativeRun();
    await writeFile(
      join(directory, "result.json"),
      JSON.stringify(result, null, 2) + "\n",
      { mode: 0o600 },
    );
    console.log(
      JSON.stringify(
        {
          ...result,
          mocha: { ...result.mocha, cases: undefined },
          browser: { ...result.browser, cases: undefined },
        },
        null,
        2,
      ),
    );
  } finally {
    await release();
  }
}
if (process.argv[1]?.endsWith("apps/evaluator/preact-native-v5.ts"))
  main().catch((e) => {
    console.error(
      e instanceof Error ? e.message : "Native qualification failed",
    );
    process.exitCode = 1;
  });
