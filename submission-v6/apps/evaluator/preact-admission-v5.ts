import { existsSync, readFileSync } from "node:fs";
import { mkdir, open, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { auditNativeRun } from "./preact-native-v5.ts";
import {
  checkedNativeSuite,
  nativeIntegrity,
  nativeTypeCounts,
  shaNative,
} from "../../packages/evaluation/preact-native-v5.ts";
import {
  auditAdmission,
  ADMISSION_FREEZE,
  admissionPlan,
  admissionObservations,
  type FixtureVariant,
} from "../../packages/evaluation/preact-admission-v5.ts";
import {
  PreactAdmissionSandbox,
  ADMISSION_PARENT,
  admissionInput,
  admissionRequest,
  parseAdmissionReceipt,
  validateAdmissionUpload,
} from "../../packages/execution/preact-admission-v5.ts";
import { preactRepairContext } from "../../packages/repositories/preact-admission-v5.ts";
import { acquireRepairLease } from "../../packages/repositories/repair-lease.ts";

const directory = ".repolab/preact-admission-v5/run";
function classify(
  variant: FixtureVariant,
  scope: "public" | "independent",
  value: unknown,
) {
  const r = admissionObservations(value, scope);
  const failures =
    variant === "reference"
      ? []
      : variant === "weak"
        ? scope === "public"
          ? []
          : ["stable-rerender", "replace-ref", "remove-ref"]
        : scope === "public"
          ? ["returned-cleanup"]
          : [
              "stable-rerender",
              "replace-ref",
              "remove-ref",
              "shared-callback",
              "remount",
              "component-ref",
              "cleanup-error-boundary",
              "keyed-replacement",
            ];
  if (JSON.stringify(r.failed) !== JSON.stringify(failures))
    throw Error(
      "Reviewed fixture behavior differs from prospective qualification",
    );
  return r;
}
export function auditPreactAdmissionRun() {
  auditAdmission();
  const parent = auditNativeRun();
  if (parent.protectedImage !== ADMISSION_PARENT)
    throw Error("Qualified original parent changed");
  const ids = new Set<string>();
  const images: Record<FixtureVariant, string> = {
    original: ADMISSION_PARENT,
    weak: ADMISSION_PARENT,
    reference: ADMISSION_PARENT,
  };
  const results: Record<string, ReturnType<typeof parseAdmissionReceipt>> = {};
  for (const { variant, stage } of admissionPlan()) {
    const id = variant + "-" + stage;
    const r = JSON.parse(readFileSync(join(directory, id + ".json"), "utf8"));
    if (
      ids.has(r.id) ||
      r.sourceHash !== admissionInput(variant).sourceHash ||
      r.variant !== variant ||
      r.stage !== stage ||
      r.inference !== "none" ||
      r.execution !== "nebius-sandbox; reviewed fixture"
    )
      throw Error("Qualification source/provenance/operation reuse");
    ids.add(r.id);
    const expectedFiles: Record<string, unknown> = {};
    const staged =
      variant === "original"
        ? admissionInput(variant).files
        : stage === "build"
          ? admissionInput(variant).files
          : {};
    const uploads = JSON.parse(
      readFileSync(join(directory, "uploads-" + variant + ".json"), "utf8"),
    );
    for (const [path, bytes] of Object.entries(staged)) {
      const descriptor = uploads.files[path];
      const u = JSON.parse(
        readFileSync(
          join(directory, "upload-" + descriptor.recordName + ".json"),
          "utf8",
        ),
      );
      if (
        u.status !== "VERIFIED" ||
        u.path !== path ||
        u.sha256 !== shaNative(bytes) ||
        u.response.sha256 !== u.sha256 ||
        ![-1, bytes.length].includes(u.response.size) ||
        descriptor.handle.uuid !== u.response.uuid
      )
        throw Error("Qualification upload changed");
      expectedFiles[path] = validateAdmissionUpload(descriptor, u, path, bytes);
    }
    if (stage.startsWith("independent")) {
      const descriptor = uploads.independent;
      const u = JSON.parse(
        readFileSync(
          join(directory, "upload-" + descriptor.recordName + ".json"),
          "utf8",
        ),
      );
      if (
        u.status !== "VERIFIED" ||
        u.path !== "/opt/repolab/native/independent.html" ||
        u.sha256 !==
          shaNative(
            readFileSync("evaluation/preact-admission-independent-v4.html"),
          ) ||
        u.response.sha256 !== u.sha256 ||
        descriptor.handle.uuid !== u.response.uuid
      )
        throw Error("Independent upload changed");
      expectedFiles["/opt/repolab/native/independent.html"] = descriptor.handle;
      validateAdmissionUpload(
        descriptor,
        u,
        "/opt/repolab/native/independent.html",
        readFileSync("evaluation/preact-admission-independent-v4.html"),
      );
      if (variant !== "original") {
        const selection = JSON.parse(
          readFileSync(
            join(directory, "selection-" + variant + ".json"),
            "utf8",
          ),
        );
        if (
          selection.sourceHash !== r.sourceHash ||
          selection.provenance !== "reviewed fixture; not a model selection" ||
          selection.publicReceiptHashes.some(
            (h: string, i: number) =>
              h !==
              shaNative(
                readFileSync(
                  join(
                    directory,
                    variant + "-public-" + ["A", "B"][i] + ".json",
                  ),
                ),
              ),
          )
        )
          throw Error("Selection binding changed");
        if (!results[variant + "-public-B"])
          throw Error("Independent evaluation preceded public selection");
      }
    }
    if (
      JSON.stringify(r.request) !==
      JSON.stringify(admissionRequest(stage, images[variant], expectedFiles))
    )
      throw Error("Qualification submitted recipe changed");
    const result = parseAdmissionReceipt(
      r.latest,
      stage,
      r.id,
      images[variant],
      r.sourceHash,
    );
    results[id] = result;
    if (stage === "build") images[variant] = result.op.result_image_uuid!;
    if (stage === "integrity") nativeIntegrity(result.guest);
    if (stage.startsWith("mocha"))
      checkedNativeSuite(result.guest.mocha, "mocha");
    if (stage.startsWith("browser"))
      checkedNativeSuite(result.guest.browser, "browser");
    if (stage === "types") nativeTypeCounts(result.guest.commands[0].stdout);
    if (stage.startsWith("public") || stage.startsWith("independent"))
      classify(
        variant,
        stage.startsWith("public") ? "public" : "independent",
        result.guest.observations,
      );
  }
  for (const variant of ["original", "weak", "reference"] as const)
    for (const scope of ["public", "independent"])
      if (
        JSON.stringify(
          results[variant + "-" + scope + "-A"].guest.observations,
        ) !==
        JSON.stringify(results[variant + "-" + scope + "-B"].guest.observations)
      )
        throw Error("Repeated lifecycle observations changed");
  return {
    format: "repolab-preact-admission-result/v5",
    freeze: ADMISSION_FREEZE,
    status: "QUALIFIED_SCOPED_ADMISSION",
    taskId: "preactjs__preact-4436",
    execution:
      "nebius-sandbox; reviewed original/incomplete/reference fixtures",
    inference: "none",
    modelAttempts: 0,
    modelAdmission: false,
    operationIds: [...ids],
    nativeRuntime: "v20.9.0",
    original: {
      public: classify(
        "original",
        "public",
        results["original-public-A"].guest.observations,
      ),
      independent: classify(
        "original",
        "independent",
        results["original-independent-A"].guest.observations,
      ),
    },
    weak: {
      sourceHash: admissionInput("weak").sourceHash,
      public: classify(
        "weak",
        "public",
        results["weak-public-A"].guest.observations,
      ),
      independent: classify(
        "weak",
        "independent",
        results["weak-independent-A"].guest.observations,
      ),
    },
    reference: {
      sourceHash: admissionInput("reference").sourceHash,
      public: classify(
        "reference",
        "public",
        results["reference-public-A"].guest.observations,
      ),
      independent: classify(
        "reference",
        "independent",
        results["reference-independent-A"].guest.observations,
      ),
      mocha: checkedNativeSuite(
        results["reference-mocha-A"].guest.mocha,
        "mocha",
      ),
      browser: checkedNativeSuite(
        results["reference-browser-A"].guest.browser,
        "browser",
      ),
      types: nativeTypeCounts(
        results["reference-types"].guest.commands[0].stdout,
      ),
    },
  };
}
async function main() {
  const action = process.argv[2] ?? "plan";
  auditAdmission();
  if (action === "plan") {
    console.log(
      JSON.stringify(
        {
          freeze: ADMISSION_FREEZE,
          slots: admissionPlan(),
          inference: "none",
          execution: "none; planning",
          modelAdmission: false,
        },
        null,
        2,
      ),
    );
    return;
  }
  if (action === "audit") {
    console.log(JSON.stringify(auditPreactAdmissionRun(), null, 2));
    return;
  }
  if (action === "context" && process.argv[3]) {
    await writeFile(
      process.argv[3],
      JSON.stringify(preactRepairContext(), null, 2) + "\n",
      { flag: "wx", mode: 0o600 },
    );
    return;
  }
  if (action !== "qualify")
    throw Error("Use plan, qualify, audit or context NEW_PRIVATE_FILE");
  if (existsSync(join(directory, "STARTED.json")))
    throw Error("Qualification already started; no fixed-slot retry");
  if (auditNativeRun().protectedImage !== ADMISSION_PARENT)
    throw Error("Original qualification parent changed");
  const release = await acquireRepairLease(".repolab", "preact-admission-v5");
  try {
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const f = await open(join(directory, "STARTED.json"), "wx", 0o600);
    await f.writeFile(
      JSON.stringify({
        freeze: ADMISSION_FREEZE,
        inference: "none",
        execution: "nebius-sandbox; reviewed fixtures",
      }),
    );
    await f.close();
    const client = new PreactAdmissionSandbox(directory);
    const descriptors: Record<
      string,
      {
        files: Record<string, { recordName: string; handle: unknown }>;
        independent?: { recordName: string; handle: unknown };
      }
    > = {};
    const images: Record<FixtureVariant, string> = {
      original: ADMISSION_PARENT,
      weak: ADMISSION_PARENT,
      reference: ADMISSION_PARENT,
    };
    for (const { variant, stage } of admissionPlan()) {
      const input = admissionInput(variant);
      let descriptor = descriptors[variant];
      if (!descriptor) {
        descriptor = { files: {} };
        let index = 0;
        for (const [path, bytes] of Object.entries(input.files)) {
          const recordName = variant + "-" + index++;
          const handle = await client.upload(path, bytes, recordName);
          descriptor.files[path] = { recordName, handle };
        }
        descriptors[variant] = descriptor;
      }
      const files: Record<string, unknown> =
        variant === "original" || stage === "build"
          ? Object.fromEntries(
              Object.entries(descriptor.files).map(([path, d]) => [
                path,
                d.handle,
              ]),
            )
          : {};
      if (stage.startsWith("independent")) {
        if (
          variant !== "original" &&
          !existsSync(join(directory, "selection-" + variant + ".json"))
        ) {
          await writeFile(
            join(directory, "selection-" + variant + ".json"),
            JSON.stringify(
              {
                sourceHash: input.sourceHash,
                provenance: "reviewed fixture; not a model selection",
                publicReceiptHashes: ["A", "B"].map((letter) =>
                  shaNative(
                    readFileSync(
                      join(directory, variant + "-public-" + letter + ".json"),
                    ),
                  ),
                ),
              },
              null,
              2,
            ) + "\n",
            { flag: "wx", mode: 0o600 },
          );
        }
        if (!descriptor.independent) {
          const recordName = variant + "-independent";
          descriptor.independent = {
            recordName,
            handle: await client.upload(
              "/opt/repolab/native/independent.html",
              readFileSync("evaluation/preact-admission-independent-v4.html"),
              recordName,
            ),
          };
        }
        files["/opt/repolab/native/independent.html"] =
          descriptor.independent.handle;
      }
      await writeFile(
        join(directory, "uploads-" + variant + ".json"),
        JSON.stringify(descriptor, null, 2) + "\n",
        { mode: 0o600 },
      );
      console.log(
        JSON.stringify({
          variant,
          stage,
          status: "STARTING",
          inference: "none",
          execution: "nebius-sandbox; reviewed fixture",
        }),
      );
      const r = await client.run(
        variant,
        stage,
        images[variant],
        input.sourceHash,
        files,
      );
      if (stage === "build") images[variant] = r.op.result_image_uuid!;
      if (stage === "integrity") nativeIntegrity(r.guest);
      if (stage.startsWith("mocha")) checkedNativeSuite(r.guest.mocha, "mocha");
      if (stage.startsWith("browser"))
        checkedNativeSuite(r.guest.browser, "browser");
      if (stage === "types") nativeTypeCounts(r.guest.commands[0].stdout);
      if (stage.startsWith("public") || stage.startsWith("independent"))
        classify(
          variant,
          stage.startsWith("public") ? "public" : "independent",
          r.guest.observations,
        );
      console.log(
        JSON.stringify({
          variant,
          stage,
          status: "COMPLETED",
          operationId: r.op.uuid,
        }),
      );
    }
    const result = auditPreactAdmissionRun();
    await writeFile(
      join(directory, "result.json"),
      JSON.stringify(result, null, 2) + "\n",
      { mode: 0o600 },
    );
    console.log(
      JSON.stringify({
        status: result.status,
        operations: result.operationIds.length,
        inference: "none",
        execution: result.execution,
      }),
    );
  } finally {
    await release();
  }
}
if (process.argv[1]?.endsWith("apps/evaluator/preact-admission-v5.ts"))
  main().catch((e) => {
    console.error(e instanceof Error ? e.message : "Qualification failed");
    process.exitCode = 1;
  });
