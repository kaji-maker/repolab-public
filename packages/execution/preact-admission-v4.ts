import { readFileSync } from "node:fs";
import { mkdir, open, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { z } from "zod";
import { sandboxConfigFromEnv } from "./nebius.ts";
import {
  nativeEnvironment,
  nativeStage,
  shaNative,
} from "../evaluation/preact-native-v5.ts";
import {
  auditAdmission,
  admissionFixture,
  type FixtureVariant,
} from "../evaluation/preact-admission-v4.ts";
import { preactOriginalSources } from "../repositories/preact-admission-v4.ts";

export const ADMISSION_PARENT = "d4c8d3fb-7f4c-48dc-9c81-0522eb247051";
export function admissionInput(variant: FixtureVariant) {
  const fixture = admissionFixture(variant);
  const sources = fixture?.files ?? preactOriginalSources();
  const m = JSON.parse(
    readFileSync("fixtures/preact-native/original-manifest.json", "utf8"),
  );
  m.format = "repolab-preact-admission-input/v1";
  m.execution =
    "Reviewed fixture source staged in Sandbox only; no model candidate";
  m.sourceHash =
    fixture?.sourceHash ??
    shaNative(
      JSON.stringify(
        Object.entries(sources).map(([path, text]) => ({
          path,
          sha256: shaNative(text),
        })),
      ),
    );
  m.files = m.files.map(
    (f: { path: string; sha256: string; bytes: number }) => ({
      ...f,
      originalSha256: f.sha256,
      originalBytes: f.bytes,
      sha256: f.path in sources ? shaNative(sources[f.path]) : f.sha256,
      bytes: f.path in sources ? Buffer.byteLength(sources[f.path]) : f.bytes,
    }),
  );
  m.auxiliary = Object.fromEntries(
    [
      [
        "/opt/repolab/native/admission-guest.cjs",
        "repositories/preact-admission-v1/guest.cjs",
      ],
      [
        "/opt/repolab/native/public.html",
        "repositories/preact-admission-v3/public.html",
      ],
      [
        "/opt/repolab/native/karma.cjs",
        "repositories/preact-native-v5/karma.cjs",
      ],
    ].map(([path, source]) => [path, shaNative(readFileSync(source))]),
  );
  m.independentSha256 = shaNative(
    readFileSync("evaluation/preact-admission-independent-v4.html"),
  );
  const files: Record<string, Buffer> = {
    "/opt/repolab/native/admission-manifest.json": Buffer.from(
      JSON.stringify(m),
    ),
    "/opt/repolab/native/admission-guest.cjs": readFileSync(
      "repositories/preact-admission-v1/guest.cjs",
    ),
    "/opt/repolab/native/public.html": readFileSync(
      "repositories/preact-admission-v3/public.html",
    ),
  };
  if (fixture)
    for (const [path, text] of Object.entries(sources))
      files["/opt/repolab/preact/" + path] = Buffer.from(text);
  return { files, sourceHash: m.sourceHash as string };
}
export function admissionRequest(
  stage: string,
  image: string,
  files: Record<string, unknown> = {},
) {
  const base = stage.replace(/-[AB]$/, "");
  z.enum([
    "build",
    "integrity",
    "lint",
    "mocha",
    "types",
    "browser",
    "public",
    "independent",
  ]).parse(base);
  z.uuid().parse(image);
  const slot =
    base === "public" || base === "independent"
      ? "reproduction-A"
      : (stage as Parameters<typeof nativeStage>[0]);
  return {
    command: "/usr/local/bin/node",
    args: ["/opt/repolab/native/admission-guest.cjs", base],
    image,
    shell: false,
    preserve_env: false,
    env: nativeEnvironment(slot),
    cwd: "/opt/repolab",
    uid: base === "build" ? 0 : 1000,
    gid: base === "build" ? 0 : 1000,
    networking: { enabled: false },
    timeout: 600,
    truncate_output_at: 4194304,
    disposable: base !== "build",
    resources_limits: { max_layer_bytes: 1073741824 },
    files,
  };
}
const Stream = z.object({
  value: z.string(),
  encoding: z.enum(["ascii", "base64", "utf8", "utf-8", "plain"]),
  truncated: z.literal(false),
});
export function validateAdmissionUpload(
  descriptor: unknown,
  record: unknown,
  path: string,
  bytes: Buffer,
) {
  const d = z
    .object({
      recordName: z.string(),
      handle: z
        .object({
          uuid: z.uuid(),
          uid: z.literal(0),
          gid: z.literal(0),
          mode: z.literal("0444"),
        })
        .strict(),
    })
    .strict()
    .parse(descriptor);
  const r = z
    .object({
      status: z.literal("VERIFIED"),
      path: z.literal(path),
      sha256: z.literal(shaNative(bytes)),
      bytes: z.literal(bytes.length),
      response: z.object({
        uuid: z.literal(d.handle.uuid),
        sha256: z.literal(shaNative(bytes)),
        size: z.number().int(),
      }),
    })
    .parse(record);
  if (![-1, bytes.length].includes(r.response.size))
    throw Error("Admission upload size changed");
  return d.handle;
}
export function parseAdmissionReceipt(
  raw: unknown,
  stage: string,
  id: string,
  image: string,
  sourceHash: string,
) {
  const op = z
    .object({
      uuid: z.uuid(),
      image_uuid: z.uuid(),
      status: z.literal("SUCCESS"),
      result_image_uuid: z.uuid().nullish(),
      metadata: z.object({
        result: z
          .object({
            state: z.object({
              exit_code: z.literal(0),
              signal: z.number().nullable(),
              timed_out: z.literal(false),
            }),
            stdout: Stream,
            stderr: Stream,
          })
          .passthrough(),
      }),
    })
    .passthrough()
    .parse(raw);
  if (
    op.uuid !== id ||
    op.image_uuid !== image ||
    ![null, 0, -1].includes(op.metadata.result.state.signal)
  )
    throw Error("Admission operation identity/state changed");
  const decode = (s: z.infer<typeof Stream>) => {
    const b = Buffer.from(s.value, s.encoding === "base64" ? "base64" : "utf8");
    if (b.length > 4194304) throw Error("Admission output cap exceeded");
    return b.toString("utf8");
  };
  decode(op.metadata.result.stderr);
  const g = z
    .object({
      stage: z.string(),
      sourceHash: z.string(),
      runtimeVersion: z.literal("v20.9.0"),
      uid: z.number(),
      gid: z.number(),
      envKeys: z.array(z.string()),
      expectedInputsIntact: z.literal(true),
      completed: z.literal(true),
      commands: z.array(
        z.object({
          executable: z.string(),
          args: z.array(z.string()),
          exitCode: z.literal(0),
          signal: z.null(),
          errorCode: z.null(),
          stdout: z.string(),
          stderr: z.string(),
        }),
      ),
    })
    .passthrough()
    .parse(JSON.parse(decode(op.metadata.result.stdout)));
  const req = admissionRequest(stage, image);
  if (
    g.stage !== req.args[1] ||
    g.sourceHash !== sourceHash ||
    g.uid !== req.uid ||
    g.gid !== req.gid ||
    JSON.stringify([...g.envKeys].sort()) !==
      JSON.stringify(Object.keys(req.env).sort())
  )
    throw Error("Admission recipe binding changed");
  const base = req.args[1];
  const commands: Record<string, [string, string[]][]> = {
    build: [["/usr/local/bin/npm", ["run", "build"]]],
    integrity: [],
    lint: [["/usr/local/bin/npm", ["run", "lint"]]],
    mocha: [
      [
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
    ],
    types: [["/usr/local/bin/npm", ["run", "test:ts"]]],
    browser: [["/usr/local/bin/node", ["/opt/repolab/native/karma.cjs"]]],
    public: [
      [
        "/usr/bin/chromium",
        [
          "--headless",
          "--no-sandbox",
          "--disable-gpu",
          "--disable-dev-shm-usage",
          "--no-first-run",
          "--dump-dom",
          "file:///opt/repolab/native/public.html",
        ],
      ],
    ],
    independent: [
      [
        "/usr/bin/chromium",
        [
          "--headless",
          "--no-sandbox",
          "--disable-gpu",
          "--disable-dev-shm-usage",
          "--no-first-run",
          "--dump-dom",
          "file:///opt/repolab/native/independent.html",
        ],
      ],
    ],
  };
  if (
    JSON.stringify(g.commands.map((c) => [c.executable, c.args])) !==
      JSON.stringify(commands[base]) ||
    (base === "build" && !op.result_image_uuid)
  )
    throw Error("Admission command or prepared image changed");
  return { op, guest: g };
}
export class PreactAdmissionSandbox {
  private config = sandboxConfigFromEnv();
  private directory: string;
  constructor(directory: string) {
    this.directory = directory;
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
    auditAdmission();
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
    variant: FixtureVariant,
    stage: string,
    image: string,
    sourceHash: string,
    files: Record<string, unknown>,
  ) {
    if (sourceHash !== admissionInput(variant).sourceHash)
      throw Error("Reviewed fixture source binding changed");
    auditAdmission();
    const request = admissionRequest(stage, image, files);
    const dest = join(this.directory, variant + "-" + stage + ".json");
    const record: Record<string, unknown> = {
      variant,
      stage,
      request,
      sourceHash,
      inference: "none",
      execution: "nebius-sandbox; reviewed fixture",
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
