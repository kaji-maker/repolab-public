import { readFileSync } from "node:fs";
import { mkdir, open, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { z } from "zod";
import { sandboxConfigFromEnv } from "./nebius.ts";
import { shaNative } from "../evaluation/preact-native-v5.ts";
import {
  auditTrialFreeze,
  assertTrialNoCredentials,
} from "../evaluation/preact-trial-v2.ts";
import {
  admitPreactEdit,
  preactOriginalSources,
} from "../repositories/preact-admission-v5.ts";
import {
  admissionInput,
  admissionRequest,
  parseAdmissionReceipt,
} from "./preact-admission-v5.ts";

export const trialVariantSchema = z.enum([
  "original",
  "candidate-1",
  "candidate-2",
  "candidate-3",
]);
/** Static unified diff bytes; neither original nor candidate source is executed. */
export function trialPatch(proposal: unknown) {
  const original = preactOriginalSources(),
    candidate = admitPreactEdit(proposal);
  let patch = "";
  for (const [path, text] of Object.entries(candidate.files)) {
    const old = original[path];
    if (old === text) continue;
    if (!old.endsWith("\n") || !text.endsWith("\n"))
      throw Error("Source newline convention changed");
    const before = old.slice(0, -1).split("\n"),
      after = text.slice(0, -1).split("\n");
    patch +=
      "diff --git a/" +
      path +
      " b/" +
      path +
      "\n--- a/" +
      path +
      "\n+++ b/" +
      path +
      "\n@@ -1," +
      before.length +
      " +1," +
      after.length +
      " @@\n" +
      before.map((l) => "-" + l + "\n").join("") +
      after.map((l) => "+" + l + "\n").join("");
  }
  return patch;
}
export function trialInput(proposal: unknown) {
  const original = admissionInput("original");
  if (proposal === null) return original;
  assertTrialNoCredentials(proposal);
  const candidate = admitPreactEdit(proposal);
  const manifest = JSON.parse(
    original.files["/opt/repolab/native/admission-manifest.json"].toString(
      "utf8",
    ),
  );
  manifest.format = "repolab-preact-trial-input/v2";
  manifest.execution =
    "Nebius model-generated scoped candidate; executes only in Sandbox";
  manifest.sourceHash = candidate.sourceHash;
  manifest.files = manifest.files.map(
    (f: { path: string; sha256: string; bytes: number }) =>
      f.path in candidate.files
        ? {
            ...f,
            sha256: shaNative(candidate.files[f.path]),
            bytes: Buffer.byteLength(candidate.files[f.path]),
          }
        : f,
  );
  const files = { ...original.files };
  files["/opt/repolab/native/admission-manifest.json"] = Buffer.from(
    JSON.stringify(manifest),
  );
  for (const [path, text] of Object.entries(candidate.files))
    files["/opt/repolab/preact/" + path] = Buffer.from(text);
  return { files, sourceHash: candidate.sourceHash };
}
/** A rejected native command is never a passing gate or permission to weaken checks. */
export function rejectedTrialReceipt(
  raw: unknown,
  stage: string,
  id: string,
  image: string,
  sourceHash: string,
) {
  const base = stage.replace(/-[AB]$/, "");
  const commands: Record<string, [string, string[]]> = {
    build: ["/usr/local/bin/npm", ["run", "build"]],
    lint: ["/usr/local/bin/npm", ["run", "lint"]],
    mocha: [
      "/usr/local/bin/node",
      [
        "/opt/repolab/preact/node_modules/mocha/bin/mocha",
        "--recursive",
        "--require",
        "@babel/register",
        "--reporter",
        "json",
        "test/shared",
        "test/node",
      ],
    ],
    types: ["/usr/local/bin/npm", ["run", "test:ts"]],
    browser: ["/usr/local/bin/node", ["/opt/repolab/native/karma.cjs"]],
  };
  if (!commands[base])
    throw Error("This stage cannot be classified as a native rejection");
  const stream = z.object({
    value: z.string(),
    encoding: z.enum(["ascii", "base64", "utf8", "utf-8", "plain"]),
    truncated: z.literal(false),
  });
  const op = z
    .object({
      uuid: z.literal(id),
      image_uuid: z.literal(image),
      status: z.enum(["SUCCESS", "FAILED"]),
      metadata: z.object({
        result: z.object({
          state: z.object({
            exit_code: z.literal(1),
            signal: z.union([z.null(), z.literal(0), z.literal(-1)]),
            timed_out: z.literal(false),
          }),
          stdout: stream,
          stderr: stream,
        }),
      }),
    })
    .passthrough()
    .parse(raw);
  const decode = (s: z.infer<typeof stream>) => {
    const b = Buffer.from(s.value, s.encoding === "base64" ? "base64" : "utf8");
    if (b.length > 4194304)
      throw Error("Failure output truncated or excessive");
    return b.toString("utf8");
  };
  decode(op.metadata.result.stderr);
  const g = z
    .object({
      stage: z.literal(base),
      sourceHash: z.literal(sourceHash),
      runtimeVersion: z.literal("v20.9.0"),
      uid: z.number(),
      gid: z.number(),
      envKeys: z.array(z.string()),
      completed: z.literal(false),
      error: z.literal("Native stage failed; raw child output retained"),
      commands: z
        .array(
          z.object({
            executable: z.string(),
            args: z.array(z.string()),
            exitCode: z.number().int().positive(),
            signal: z.null(),
            errorCode: z.null(),
            stdout: z.string(),
            stderr: z.string(),
          }),
        )
        .length(1),
    })
    .passthrough()
    .parse(JSON.parse(decode(op.metadata.result.stdout)));
  const req = admissionRequest(stage, image);
  if (
    g.uid !== req.uid ||
    g.gid !== req.gid ||
    JSON.stringify([...g.envKeys].sort()) !==
      JSON.stringify(Object.keys(req.env).sort()) ||
    JSON.stringify([g.commands[0].executable, g.commands[0].args]) !==
      JSON.stringify(commands[base])
  )
    throw Error("Rejected native recipe binding changed");
  assertTrialNoCredentials(g);
  const c = g.commands[0];
  return {
    op,
    guest: g,
    feedback: {
      kind: "native",
      stage,
      exitCode: c.exitCode,
      stdout: c.stdout.slice(-6000),
      stderr: c.stderr.slice(-2000),
    },
  };
}
export class PreactTrialSandbox {
  private config = sandboxConfigFromEnv();
  private directory: string;
  private variant: string;
  private sourceHash: string;
  constructor(directory: string, variant: string, proposal: unknown) {
    this.directory = directory;
    this.variant = trialVariantSchema.parse(variant);
    this.sourceHash = trialInput(proposal).sourceHash;
    if ((variant === "original") !== (proposal === null))
      throw Error("Trial variant/proposal mismatch");
  }
  private async request(route: string, init: RequestInit = {}) {
    if (
      !this.config.token ||
      !this.config.project ||
      !this.config.coverageConfirmed ||
      this.config.baseUrl !== "https://api.tokenfactory.nebius.com/sandboxes/"
    )
      throw Error("Admission Sandbox configuration unavailable");
    const r = await fetch(new URL("v1/" + route, this.config.baseUrl), {
      ...init,
      headers: {
        Authorization: "Bearer " + this.config.token,
        Project: this.config.project,
        ...init.headers,
      },
      redirect: "error",
      signal: AbortSignal.timeout(15000),
    });
    if (!r.ok)
      throw Error("Admission Sandbox HTTP " + r.status + "; no POST retry");
    return r;
  }
  async upload(path: string, bytes: Buffer, recordName: string) {
    if (
      !/^\/opt\/repolab\/(native\/(admission-manifest\.json|admission-guest\.cjs|public\.html|independent\.html)|preact\/src\/(diff\/(index|children)\.js|internal\.d\.ts))$/.test(
        path,
      ) ||
      bytes.length > 131072 ||
      !/^[a-z0-9-]+$/.test(recordName)
    )
      throw Error("Admission file path or bytes not admitted");
    assertTrialNoCredentials(bytes.toString("utf8"));
    auditTrialFreeze();
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const dest = join(this.directory, "upload-" + recordName + ".json");
    const record: Record<string, unknown> = {
      path,
      sha256: shaNative(bytes),
      bytes: bytes.length,
      status: "SUBMITTING",
    };
    const f = await open(dest, "wx", 0o600);
    await f.writeFile(JSON.stringify(record));
    await f.close();
    try {
      const r = z
        .object({ uuid: z.uuid(), sha256: z.string(), size: z.number() })
        .parse(
          await (
            await this.request("files", {
              method: "POST",
              headers: { "Content-Type": "application/octet-stream" },
              body: new Uint8Array(bytes),
            })
          ).json(),
        );
      record.response = r;
      if (r.sha256 !== record.sha256 || ![-1, bytes.length].includes(r.size))
        throw Error("Admission upload identity mismatch");
      record.status = "VERIFIED";
      return { uuid: r.uuid, uid: 0, gid: 0, mode: "0444" };
    } catch {
      record.status = "FAILED";
      throw Error("Admission upload failed; evidence retained");
    } finally {
      await writeFile(dest, JSON.stringify(record, null, 2) + "\n", {
        mode: 0o600,
      });
    }
  }
  async run(
    variant: string,
    stage: string,
    image: string,
    sourceHash: string,
    files: Record<string, unknown>,
  ) {
    if (variant !== this.variant || sourceHash !== this.sourceHash)
      throw Error("Frozen trial candidate source binding changed");
    auditTrialFreeze();
    const request = admissionRequest(stage, image, files);
    const dest = join(this.directory, variant + "-" + stage + ".json");
    const record: Record<string, unknown> = {
      variant,
      stage,
      request,
      sourceHash,
      inference: variant === "original" ? "none (reviewed original)" : "nebius",
      execution:
        variant === "original"
          ? "nebius-sandbox; reviewed original"
          : "nebius-sandbox; model-generated scoped candidate",
      status: "SUBMITTING",
      startedAt: new Date().toISOString(),
    };
    const f = await open(dest, "wx", 0o600);
    await f.writeFile(JSON.stringify(record));
    await f.close();
    const save = () =>
      writeFile(dest, JSON.stringify(record, null, 2) + "\n", { mode: 0o600 });
    let id: string | undefined,
      terminal = false;
    try {
      const response = await this.request("instances", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(request),
      });
      id = z.object({ uuid: z.uuid() }).parse(await response.json()).uuid;
      record.id = id;
      record.status = "SUBMITTED";
      await save();
      const location = response.headers.get("Location");
      if (
        location &&
        new URL(location, this.config.baseUrl).href !==
          new URL("v1/operations/" + id, this.config.baseUrl).href
      )
        throw Error("Admission Location mismatch");
      const deadline = Date.now() + 630000;
      while (Date.now() < deadline) {
        const raw = await (await this.request("operations/" + id)).json();
        const identity = z
          .object({ uuid: z.uuid(), image_uuid: z.uuid(), status: z.string() })
          .parse(raw);
        record.latest = raw;
        record.status = identity.status;
        await save();
        if (identity.uuid !== id || identity.image_uuid !== image)
          throw Error("Admission operation identity changed");
        if (["PENDING", "ASSIGNED", "EXECUTING"].includes(identity.status)) {
          await sleep(1000);
          continue;
        }
        terminal = true;
        const result = parseAdmissionReceipt(raw, stage, id, image, sourceHash);
        record.completedAt = new Date().toISOString();
        await save();
        return result;
      }
      throw Error("Admission polling deadline");
    } catch (e) {
      record.error =
        e instanceof Error ? e.message : "Admission operation failed";
      if (id && !terminal) {
        try {
          await this.request("operations/" + id, { method: "DELETE" });
          record.cancellation = "requested";
        } catch {
          record.cancellation = "unconfirmed";
        }
      } else if (!id) record.submissionUnconfirmed = true;
      await save();
      throw e;
    }
  }
}
