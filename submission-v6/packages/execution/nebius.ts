import { z } from "zod";
import { randomUUID } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";
import type { Execution, Executor } from "../contracts/index.ts";
import { sha256 } from "../evidence/hash.ts";
import { validateCompiledTests } from "../controller/tests.ts";
import {
  compileQualificationTests,
  getQualificationPlan,
} from "../repositories/qualification.ts";
import type { QualificationSuite } from "../repositories/qualification.ts";
import type { RepositorySnapshot } from "../repositories/prepare.ts";
import { getClsxEvaluationVariant } from "../evaluation/clsx.ts";
import type { ClsxVariant } from "../evaluation/clsx.ts";
import { clsxExecutionBlocker } from "../repositories/clsx-contract.ts";

export class SandboxError extends Error {}
export interface SandboxConfig {
  token: string;
  project: string;
  image: string;
  baseUrl: string;
  coverageConfirmed: boolean;
  fetch?: typeof fetch;
  pollMs?: number;
  maxPolls?: number;
  onOperation?: (record: {
    id: string;
    state: string;
    sourceHash: string;
    testHash: string;
    image: string;
  }) => void | Promise<void>;
}
const Uuid = z.uuid();
const Stream = z.object({
  value: z.string().max(32_768),
  encoding: z.enum(["base64", "ascii"]),
  truncated: z.boolean(),
});
const Result = z.object({
  state: z.object({
    exit_code: z.number().int().nullable(),
    signal: z.number().int().nullable(),
    timed_out: z.boolean(),
  }),
  stdout: Stream,
  stderr: Stream,
  resources: z.object({ cost: z.number().optional() }).optional(),
});
const Operation = z.object({
  uuid: Uuid,
  kind: z.literal("instance"),
  status: z.enum([
    "PENDING",
    "ASSIGNED",
    "EXECUTING",
    "SUCCESS",
    "FAILED",
    "CANCELLED",
  ]),
  image_uuid: Uuid.nullable().optional(),
  metadata: z.object({ result: Result.nullable().optional() }).optional(),
});

export class NebiusSandboxExecutor implements Executor {
  provider = "nebius-sandbox" as const;
  private config: SandboxConfig;
  private calls = 0;
  private capabilitiesChecked = false;
  constructor(config: SandboxConfig) {
    if (!config.token || !config.project)
      throw new SandboxError("Sandbox IAM token and project are required");
    if (!Uuid.safeParse(config.image).success)
      throw new SandboxError(
        "NEBIUS_SANDBOX_IMAGE must be a prepared immutable image UUID",
      );
    const url = new URL(config.baseUrl);
    if (
      url.origin !== "https://api.tokenfactory.nebius.com" ||
      url.pathname !== "/sandboxes/" ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    )
      throw new SandboxError("Use the documented HTTPS Sandboxes endpoint");
    this.config = config;
  }
  private async request(
    path: string,
    init: RequestInit = {},
    signal?: AbortSignal,
  ): Promise<Response> {
    try {
      const response = await (this.config.fetch ?? fetch)(
        new URL(`v1/${path}`, this.config.baseUrl),
        {
          ...init,
          headers: {
            Authorization: `Bearer ${this.config.token}`,
            Project: this.config.project,
            ...init.headers,
          },
          redirect: "error",
          signal: AbortSignal.any([
            AbortSignal.timeout(15_000),
            ...(signal ? [signal] : []),
          ]),
        },
      );
      if (!response.ok)
        throw new SandboxError(
          `Sandbox request returned HTTP ${response.status}; no automatic POST retry was made`,
        );
      return response;
    } catch (error) {
      if (error instanceof SandboxError) throw error;
      throw new SandboxError(
        "Sandbox response unavailable; inspect operation history before retrying",
      );
    }
  }
  async capabilities(signal?: AbortSignal) {
    const response = await this.request("whoami", {}, signal);
    const body = z
      .object({
        token_expiration: z.number().nullable(),
        permissions: z.record(z.string(), z.boolean()),
      })
      .parse(await response.json());
    if (
      body.token_expiration !== null &&
      body.token_expiration * 1000 <= Date.now() + 120_000
    )
      throw new SandboxError(
        "Sandbox IAM token is expired or expires too soon",
      );
    for (const permission of ["spawn", "spawn_disposable", "cancel"])
      if (!body.permissions[permission])
        throw new SandboxError(`Sandbox token lacks ${permission} permission`);
    this.capabilitiesChecked = true;
    return {
      expiresAt: body.token_expiration,
      canSpawn: true,
      canCancel: true,
      disposable: true,
    };
  }
  async images(signal?: AbortSignal) {
    const response = await this.request("images", {}, signal);
    return (await response.json()) as unknown;
  }
  private async upload(content: string, signal?: AbortSignal): Promise<string> {
    if (Buffer.byteLength(content) > 32_000)
      throw new SandboxError("Sandbox file exceeds the artifact cap");
    const response = await this.request(
      "files",
      {
        method: "POST",
        headers: { "Content-Type": "application/octet-stream" },
        body: content,
      },
      signal,
    );
    const file = z
      .object({ uuid: Uuid, sha256: z.string(), size: z.number().int() })
      .parse(await response.json());
    if (
      file.sha256 !== sha256(content) ||
      (file.size !== -1 && file.size !== Buffer.byteLength(content))
    )
      throw new SandboxError("Uploaded file digest or size mismatch");
    return file.uuid;
  }
  async execute(
    source: string,
    tests: string,
    signal?: AbortSignal,
  ): Promise<Execution> {
    const path = validateCompiledTests(tests, false);
    if (path === "src/index.js") throw new SandboxError(clsxExecutionBlocker);
    return this.executePrepared(source, tests, path, signal);
  }
  async executeRepositoryProbes(
    snapshot: RepositorySnapshot,
    suite: QualificationSuite,
    signal?: AbortSignal,
  ): Promise<Execution> {
    const plan = getQualificationPlan(snapshot);
    return this.executePrepared(
      plan.source,
      compileQualificationTests(snapshot, suite),
      plan.sourcePath,
      signal,
    );
  }
  async executeRepositoryEvaluation(
    snapshot: RepositorySnapshot,
    variant: ClsxVariant,
    signal?: AbortSignal,
  ): Promise<Execution> {
    const selected = getClsxEvaluationVariant(snapshot, variant);
    return this.executePrepared(
      selected.source,
      selected.tests,
      selected.sourcePath,
      signal,
    );
  }
  private async executePrepared(
    source: string,
    tests: string,
    sourcePath: string,
    signal?: AbortSignal,
  ): Promise<Execution> {
    if (!this.config.coverageConfirmed)
      throw new SandboxError(
        "Confirm sandbox credit coverage or no-charge access before execution; inference credits alone do not establish sandbox coverage",
      );
    if (++this.calls > 16)
      throw new SandboxError("Sandbox execution limit reached");
    if (!this.capabilitiesChecked) await this.capabilities(signal);
    const start = performance.now(),
      sourceHash = sha256(source),
      testHash = sha256(tests);
    const sourceFile = await this.upload(source, signal);
    const testFile = await this.upload(tests, signal);
    const body = {
      command: "/usr/local/bin/node",
      args: [
        "--permission",
        "--allow-fs-read=/tmp/repolab",
        "/tmp/repolab/test.mjs",
      ],
      shell: false,
      image: this.config.image,
      env: { PATH: "/usr/local/bin:/usr/bin:/bin", TZ: "UTC", LANG: "C.UTF-8" },
      preserve_env: false,
      cwd: "/tmp/repolab",
      uid: 1000,
      gid: 1000,
      networking: { enabled: false },
      timeout: 10,
      truncate_output_at: 16_384,
      disposable: true,
      resources_limits: { max_layer_bytes: 16_777_216 },
      files: {
        [`/tmp/repolab/${sourcePath}`]: {
          uuid: sourceFile,
          uid: 0,
          gid: 0,
          mode: "0444",
        },
        "/tmp/repolab/test.mjs": {
          uuid: testFile,
          uid: 0,
          gid: 0,
          mode: "0444",
        },
      },
    };
    let operationId: string | undefined;
    const record = async (state: string) => {
      if (operationId)
        await this.config.onOperation?.({
          id: operationId,
          state,
          sourceHash,
          testHash,
          image: this.config.image,
        });
    };
    try {
      const response = await this.request(
        "instances",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
        signal,
      );
      const created = z.object({ uuid: Uuid }).parse(await response.json());
      operationId = created.uuid;
      await record("SUBMITTED");
      // Poll the fixed known route, never an unvalidated provider Location URL.
      const location = response.headers.get("Location");
      if (location) {
        const url = new URL(location, this.config.baseUrl);
        if (
          url.href !==
          new URL(`v1/operations/${operationId}`, this.config.baseUrl).href
        )
          throw new SandboxError(
            "Sandbox operation Location does not match the submitted ID",
          );
      }
      for (let poll = 0; poll < (this.config.maxPolls ?? 40); poll++) {
        const statusResponse = await this.request(
          `operations/${operationId}`,
          {},
          signal,
        );
        const operation = Operation.parse(await statusResponse.json());
        if (
          operation.uuid !== operationId ||
          (operation.image_uuid && operation.image_uuid !== this.config.image)
        )
          throw new SandboxError("Operation identity or source image mismatch");
        if (["PENDING", "ASSIGNED", "EXECUTING"].includes(operation.status)) {
          await sleep(this.config.pollMs ?? 750, undefined, { signal });
          continue;
        }
        const parsed = Result.safeParse(operation.metadata?.result);
        if (!parsed.success || operation.status === "CANCELLED")
          throw new SandboxError(
            "Sandbox operation ended without a complete execution result",
          );
        const result = parsed.data;
        const decode = (stream: z.infer<typeof Stream>) => {
          const buffer = Buffer.from(
            stream.value,
            stream.encoding === "base64" ? "base64" : "utf8",
          );
          return {
            text: buffer.subarray(0, 16_384).toString("utf8"),
            truncated: stream.truncated || buffer.length > 16_384,
          };
        };
        const stdout = decode(result.stdout),
          stderr = decode(result.stderr);
        let runtimeVersion: string | undefined;
        try {
          runtimeVersion = z
            .object({ runtimeVersion: z.string().regex(/^v\d+\.\d+\.\d+$/) })
            .parse(JSON.parse(stdout.text)).runtimeVersion;
        } catch {
          /* Non-JSON output is rejected by the test gate. */
        }
        await record(operation.status);
        return {
          id: randomUUID(),
          operationId,
          provider: this.provider,
          sourceHash,
          testHash,
          image: this.config.image,
          // Nebius uses -1 for an unavailable exit code / absent signal.
          // Positive signals must still reach the verification failure gate.
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
      }
      throw new SandboxError(
        "Sandbox polling limit reached; execution remains unverified",
      );
    } catch (error) {
      if (operationId) {
        try {
          await this.request(`operations/${operationId}`, { method: "DELETE" });
          await record("CANCELLATION_REQUESTED");
        } catch {
          await record("CANCELLATION_UNCONFIRMED");
        }
      }
      if (signal?.aborted) throw signal.reason;
      if (error instanceof SandboxError) throw error;
      throw new SandboxError(
        "Sandbox response did not match the execution contract; inspect operation history",
      );
    }
  }
}

export function sandboxConfigFromEnv(): SandboxConfig {
  return {
    token: process.env.NEBIUS_SANDBOX_TOKEN || process.env.NEBIUS_API_KEY || "",
    project: process.env.NEBIUS_PROJECT_ID ?? "",
    image: process.env.NEBIUS_SANDBOX_IMAGE ?? "",
    baseUrl:
      process.env.NEBIUS_SANDBOX_URL ??
      "https://api.tokenfactory.nebius.com/sandboxes/",
    coverageConfirmed: process.env.NEBIUS_SANDBOX_COVERAGE_CONFIRMED === "true",
  };
}
