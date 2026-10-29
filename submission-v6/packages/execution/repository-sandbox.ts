import { randomUUID } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";
import { z } from "zod";
import { NebiusSandboxExecutor, type SandboxConfig } from "./nebius.ts";
import { sha256 } from "../evidence/hash.ts";
import type { Execution } from "../contracts/index.ts";

const Result = z.object({
  state: z.object({
    exit_code: z.number().int().nullable(),
    signal: z.number().int().nullable(),
    timed_out: z.boolean(),
  }),
  stdout: z.object({
    value: z.string(),
    encoding: z.enum(["ascii", "base64"]),
    truncated: z.boolean(),
  }),
  stderr: z.object({
    value: z.string(),
    encoding: z.enum(["ascii", "base64"]),
    truncated: z.boolean(),
  }),
  resources: z.object({ cost: z.number().optional() }).optional(),
});
const Operation = z.object({
  uuid: z.uuid(),
  kind: z.literal("instance"),
  status: z.enum([
    "PENDING",
    "ASSIGNED",
    "EXECUTING",
    "SUCCESS",
    "FAILED",
    "CANCELLED",
  ]),
  image_uuid: z.uuid(),
  result_image_uuid: z.uuid().nullable().optional(),
  metadata: z.object({ result: Result.nullable().optional() }).optional(),
});
export type StagedFile = { path: string; content: string };

/** Larger, bounded staging for reviewed repository recipes. Fixed commands; candidate entrypoints are admitted only by the dedicated pilot. */
export class RepositorySandbox {
  private config: SandboxConfig;
  private save: (record: unknown) => Promise<void>;
  constructor(config: SandboxConfig, save: (record: unknown) => Promise<void>) {
    this.config = config;
    this.save = save;
    // Reuse the controller's exact endpoint, immutable image and auth validation.
    new NebiusSandboxExecutor(config);
    if (!config.coverageConfirmed)
      throw new Error("Sandbox coverage is required");
  }
  private async request(
    route: string,
    init: RequestInit = {},
    signal?: AbortSignal,
  ) {
    const response = await (this.config.fetch ?? fetch)(
      new URL(`v1/${route}`, this.config.baseUrl),
      {
        ...init,
        headers: {
          Authorization: `Bearer ${this.config.token}`,
          Project: this.config.project,
          ...init.headers,
        },
        redirect: "error",
        signal: AbortSignal.any([
          AbortSignal.timeout(15000),
          ...(signal ? [signal] : []),
        ]),
      },
    );
    if (!response.ok)
      throw new Error(
        `Repository sandbox HTTP ${response.status}; no POST retry`,
      );
    return response;
  }
  async run(
    spec: {
      files: StagedFile[];
      phase:
        | "dependencies"
        | "stage"
        | "baseline"
        | "candidate-stage"
        | "candidate-baseline"
        | "candidate-controls"
        | "observations";
      sourceHash: string;
      testHash: string;
    },
    signal?: AbortSignal,
  ) {
    z.enum([
      "dependencies",
      "stage",
      "baseline",
      "candidate-stage",
      "candidate-baseline",
      "candidate-controls",
      "observations",
    ]).parse(spec.phase);
    await new NebiusSandboxExecutor(this.config).capabilities(signal);
    if (
      spec.files.length > 10 ||
      spec.files.reduce((n, f) => n + Buffer.byteLength(f.content), 0) > 262144
    )
      throw new Error("Repository staging cap exceeded");
    const files: Record<
      string,
      { uuid: string; uid: number; gid: number; mode: string }
    > = {};
    for (const file of spec.files) {
      if (
        !/^\/(?:tmp|opt)\/repolab\/[a-zA-Z0-9_./-]+$/.test(file.path) ||
        file.path.includes("..") ||
        files[file.path] ||
        Buffer.byteLength(file.content) > 131072
      )
        throw new Error("Invalid staged repository file");
      const response = await this.request(
        "files",
        {
          method: "POST",
          headers: { "Content-Type": "application/octet-stream" },
          body: file.content,
        },
        signal,
      );
      const body = z
        .object({ uuid: z.uuid(), sha256: z.string(), size: z.number().int() })
        .parse(await response.json());
      if (
        body.sha256 !== sha256(file.content) ||
        (body.size !== -1 && body.size !== Buffer.byteLength(file.content))
      )
        throw new Error("Repository upload digest mismatch");
      files[file.path] = { uuid: body.uuid, uid: 0, gid: 0, mode: "0444" };
    }
    const preparation = ["dependencies", "stage", "candidate-stage"].includes(
      spec.phase,
    );
    const candidateRunners = {
      "candidate-stage": "/opt/repolab/candidate-stage.mjs",
      "candidate-baseline": "/opt/repolab/candidate-runner.mjs",
      "candidate-controls": "/opt/repolab/candidate-controls.mjs",
      observations: "/tmp/repolab/test.mjs",
    };
    const runner =
      spec.phase in candidateRunners
        ? candidateRunners[spec.phase as keyof typeof candidateRunners]
        : spec.phase === "dependencies"
          ? "/opt/repolab/dependencies/setup.mjs"
          : spec.phase === "stage"
            ? "/opt/repolab/baseline-stage.mjs"
            : "/opt/repolab/baseline-runner.mjs";
    const request = {
      command: "/usr/local/bin/node",
      args:
        spec.phase === "observations"
          ? ["--permission", "--allow-fs-read=/tmp/repolab", runner]
          : [runner],
      image: this.config.image,
      shell: false,
      preserve_env: false,
      env: { PATH: "/usr/local/bin:/usr/bin:/bin", TZ: "UTC", LANG: "C.UTF-8" },
      cwd: preparation
        ? "/opt/repolab"
        : spec.phase === "observations"
          ? "/tmp/repolab"
          : "/tmp/repolab/upstream",
      uid: preparation ? 0 : 1000,
      gid: preparation ? 0 : 1000,
      networking: { enabled: spec.phase === "dependencies" },
      timeout: spec.phase === "dependencies" ? 120 : 30,
      truncate_output_at: 131072,
      disposable: !preparation,
      resources_limits: { max_layer_bytes: 536870912 },
      files,
    };
    const record: { [key: string]: unknown } = {
      startedAt: new Date().toISOString(),
      request,
      status: "SUBMITTING",
      sourceHash: spec.sourceHash,
      testHash: spec.testHash,
      inference: "none",
      execution: "nebius-sandbox",
    };
    await this.save(record);
    const start = performance.now();
    let id: string | undefined;
    try {
      const response = await this.request(
        "instances",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(request),
        },
        signal,
      );
      id = z.object({ uuid: z.uuid() }).parse(await response.json()).uuid;
      record.id = id;
      record.status = "SUBMITTED";
      await this.save(record);
      const location = response.headers.get("Location");
      if (
        location &&
        new URL(location, this.config.baseUrl).href !==
          new URL(`v1/operations/${id}`, this.config.baseUrl).href
      )
        throw new Error("Repository operation Location mismatch");
      for (
        let poll = 0;
        poll < (spec.phase === "dependencies" ? 180 : 50);
        poll++
      ) {
        const raw = await (
          await this.request(`operations/${id}`, {}, signal)
        ).json();
        const op = Operation.parse(raw);
        if (op.uuid !== id || op.image_uuid !== this.config.image)
          throw new Error("Repository operation identity mismatch");
        record.latest = raw;
        record.status = op.status;
        await this.save(record);
        if (["PENDING", "ASSIGNED", "EXECUTING"].includes(op.status)) {
          await sleep(750, undefined, { signal });
          continue;
        }
        if (op.status !== "SUCCESS" || !op.metadata?.result)
          throw new Error("Repository operation has no complete result");
        const result = op.metadata.result;
        const decode = (stream: typeof result.stdout) => {
          const bytes = Buffer.from(
            stream.value,
            stream.encoding === "base64" ? "base64" : "utf8",
          );
          return {
            text: bytes.subarray(0, 131072).toString("utf8"),
            truncated: stream.truncated || bytes.length > 131072,
          };
        };
        const stdout = decode(result.stdout),
          stderr = decode(result.stderr);
        let runtimeVersion: string | undefined;
        try {
          runtimeVersion = z
            .object({ runtimeVersion: z.string().regex(/^v24\.\d+\.\d+$/) })
            .parse(JSON.parse(stdout.text)).runtimeVersion;
        } catch {}
        const execution: Execution = {
          id: randomUUID(),
          operationId: id,
          provider: "nebius-sandbox",
          image: this.config.image,
          sourceHash: spec.sourceHash,
          testHash: spec.testHash,
          exitCode:
            result.state.exit_code === -1 ? null : result.state.exit_code,
          signal:
            result.state.signal === null ||
            result.state.signal === 0 ||
            result.state.signal === -1
              ? null
              : String(result.state.signal),
          timedOut: result.state.timed_out,
          truncated: stdout.truncated || stderr.truncated,
          stdout: stdout.text,
          stderr: stderr.text,
          durationMs: Math.round(performance.now() - start),
          ...(runtimeVersion ? { runtimeVersion } : {}),
          ...(result.resources?.cost !== undefined
            ? { providerCostRaw: result.resources.cost }
            : {}),
        };
        record.completedAt = new Date().toISOString();
        record.executionResult = execution;
        await this.save(record);
        return { execution, resultImage: op.result_image_uuid ?? null };
      }
      throw new Error("Repository polling deadline");
    } catch {
      record.error =
        "Repository execution unavailable or invalid; inspect operation evidence";
      if (id) {
        try {
          await this.request(`operations/${id}`, { method: "DELETE" });
          record.cancellation = "requested";
        } catch {
          record.cancellation = "unconfirmed";
        }
      } else record.submissionUnconfirmed = true;
      await this.save(record);
      throw new Error(String(record.error));
    }
  }
}
