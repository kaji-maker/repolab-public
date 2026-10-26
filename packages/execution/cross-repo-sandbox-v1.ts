import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";
import { z } from "zod";
import type { SandboxConfig } from "./nebius.ts";
export const crossSha = (bytes: string | Buffer) =>
  createHash("sha256").update(bytes).digest("hex");
export function crossRequest(
  image: string,
  files: Record<string, unknown>,
  phase: string,
) {
  z.uuid().parse(image);
  if (!["dependencies", "stage", "native", "observations"].includes(phase))
    throw Error("Unknown cross-repository phase");
  return {
    command: "/usr/local/bin/node",
    args: ["/opt/repolab/cross/driver.cjs"],
    image,
    shell: false,
    preserve_env: false,
    env: { PATH: "/usr/local/bin:/usr/bin:/bin", TZ: "UTC", LANG: "C.UTF-8" },
    cwd: "/opt/repolab/cross",
    uid: 0,
    gid: 0,
    networking: { enabled: phase === "dependencies" },
    timeout: phase === "dependencies" ? 240 : 210,
    truncate_output_at: 524288,
    disposable: !["dependencies", "stage"].includes(phase),
    resources_limits: { max_layer_bytes: 1073741824 },
    files,
  };
}
export class CrossRepoSandbox {
  private directory: string;
  private config: SandboxConfig;
  private signal: AbortSignal;
  private fetcher: typeof fetch;
  private simulated: boolean;
  constructor(
    directory: string,
    config: SandboxConfig,
    signal: AbortSignal,
    fetcher: typeof fetch = fetch,
  ) {
    this.directory = directory;
    this.config = config;
    this.signal = signal;
    this.fetcher = fetcher;
    this.simulated = fetcher !== fetch;
    if (
      !config.token ||
      !config.project ||
      !config.coverageConfirmed ||
      config.baseUrl !== "https://api.tokenfactory.nebius.com/sandboxes/"
    )
      throw Error("Qualified Sandbox configuration required");
  }
  private async request(route: string, init: RequestInit = {}) {
    let last: unknown;
    for (let n = 0; n < ((init.method ?? "GET") === "GET" ? 3 : 1); n++) {
      let r: Response;
      try {
        r = await this.fetcher(new URL("v1/" + route, this.config.baseUrl), {
          ...init,
          headers: {
            Authorization: "Bearer " + this.config.token,
            Project: this.config.project,
            ...init.headers,
          },
          redirect: "error",
          signal: AbortSignal.any([
            this.signal,
            AbortSignal.timeout(
              (init.method ?? "GET") === "GET" ? 60000 : 20000,
            ),
          ]),
        });
      } catch (e) {
        last = e;
        if ((init.method ?? "GET") !== "GET" || this.signal.aborted) break;
        continue;
      }
      if (!r.ok)
        throw Error("Sandbox HTTP " + r.status + "; no submission retry");
      return r;
    }
    throw Error("Sandbox transport unavailable; no submission retry", {
      cause: last,
    });
  }
  async upload(bytes: Buffer, name: string, mode = "0444") {
    if (
      !/^[a-zA-Z0-9-]+$/.test(name) ||
      bytes.length > 2000000 ||
      !["0444", "0400"].includes(mode)
    )
      throw Error("Invalid bounded upload");
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const p = join(this.directory, "upload-" + name + ".json"),
      r: any = {
        status: "SUBMITTING",
        sha256: crossSha(bytes),
        bytes: bytes.length,
        mode,
        startedAt: new Date().toISOString(),
      };
    await writeFile(p, JSON.stringify(r), { flag: "wx", mode: 0o600 });
    try {
      const b = z
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
      r.response = b;
      if (b.sha256 !== r.sha256 || ![-1, bytes.length].includes(b.size))
        throw Error("Upload identity mismatch");
      r.status = "VERIFIED";
      return { uuid: b.uuid, uid: 0, gid: 0, mode };
    } catch (e) {
      r.status = "FAILED";
      throw e;
    } finally {
      await writeFile(p, JSON.stringify(r) + "\n", { mode: 0o600 });
    }
  }
  async run(name: string, request: ReturnType<typeof crossRequest>) {
    if (!/^[a-zA-Z0-9-]+$/.test(name)) throw Error("Invalid operation name");
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const p = join(this.directory, name + ".json"),
      r: any = {
        status: "SUBMITTING",
        request,
        startedAt: new Date().toISOString(),
        execution: this.simulated
          ? "simulation; source was not executed"
          : "nebius-sandbox",
      };
    await writeFile(p, JSON.stringify(r), { flag: "wx", mode: 0o600 });
    const save = () => writeFile(p, JSON.stringify(r) + "\n", { mode: 0o600 });
    let terminal = false;
    try {
      const response = await this.request("instances", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(request),
      });
      r.id = z.object({ uuid: z.uuid() }).parse(await response.json()).uuid;
      r.status = "SUBMITTED";
      await save();
      const location = response.headers.get("Location");
      if (
        location &&
        new URL(location, this.config.baseUrl).href !==
          new URL("v1/operations/" + r.id, this.config.baseUrl).href
      )
        throw Error("Operation Location mismatch");
      const deadline = Date.now() + 630000;
      while (Date.now() < deadline) {
        this.signal.throwIfAborted();
        const raw = await (await this.request("operations/" + r.id)).json();
        const op = z
          .object({
            uuid: z.uuid(),
            image_uuid: z.uuid(),
            status: z.string(),
            result_image_uuid: z.uuid().nullable().optional(),
            metadata: z.any().optional(),
          })
          .parse(raw);
        r.latest = raw;
        r.status = op.status;
        await save();
        if (op.uuid !== r.id || op.image_uuid !== request.image)
          throw Error("Operation identity mismatch");
        if (["PENDING", "ASSIGNED", "EXECUTING"].includes(op.status)) {
          await sleep(1000, undefined, { signal: this.signal });
          continue;
        }
        terminal = true;
        r.completedAt = new Date().toISOString();
        await save();
        if (op.status !== "SUCCESS" || !op.metadata?.result)
          throw Error("Operation has no complete result");
        return r;
      }
      throw Error("Operation polling deadline");
    } catch (e) {
      r.error = e instanceof Error ? e.message : "Operation failed";
      if (!r.id) r.submissionUnconfirmed = true;
      else if (!terminal) {
        r.executionUncertain = true;
        try {
          await this.request("operations/" + r.id, { method: "DELETE" });
          r.cancellation = "requested";
        } catch {
          r.cancellation = "unconfirmed";
        }
      }
      await save();
      throw e;
    }
  }
}
export function parseCrossReceipt(raw: any, config: any) {
  const op = raw.latest,
    result = op?.metadata?.result;
  if (
    raw.execution !== "nebius-sandbox" ||
    raw.submissionUnconfirmed ||
    raw.executionUncertain ||
    raw.cancellation ||
    !raw.id ||
    op?.uuid !== raw.id ||
    op?.image_uuid !== raw.request.image ||
    op?.status !== "SUCCESS" ||
    !result ||
    result.state.timed_out ||
    ![0, -1, null].includes(result.state.signal)
  )
    throw Error("Incomplete or uncertain execution evidence");
  const decode = (s: any) => {
    if (!s || s.truncated || !["ascii", "base64"].includes(s.encoding))
      throw Error("Incomplete output");
    return Buffer.from(
      s.value,
      s.encoding === "base64" ? "base64" : "utf8",
    ).toString("utf8");
  };
  const stdout = decode(result.stdout);
  decode(result.stderr);
  const guest = JSON.parse(stdout);
  if (
    result.state.exit_code !== 0 ||
    guest.error ||
    guest.format !== "repolab-cross-repo-guest/v1" ||
    guest.nonce !== config.nonce ||
    guest.taskId !== config.taskId ||
    guest.phase !== config.phase ||
    guest.sourceHash !== config.sourceHash ||
    !/^v24\./.test(guest.runtimeVersion)
  )
    throw Error(
      "Guest evidence identity or execution failed: " +
        String(guest.error ?? "invalid receipt").slice(0, 300),
    );
  return {
    guest: guest.result,
    image: op.result_image_uuid ?? null,
    id: raw.id,
  };
}
export function nativeSignature(result: any) {
  if (result.exitCode !== 0 || result.signal || result.error)
    throw Error("Original native command failed");
  const text = String(result.stdout),
    counts: any = {};
  for (const [key, pattern] of [
    ["passing", /(\d+) passing/g],
    ["tests", /#\s*tests\s+(\d+)/g],
    ["pass", /#\s*pass\s+(\d+)/g],
    ["pending", /(\d+) pending/g],
  ] as const) {
    const matches = [...text.matchAll(pattern)].map((m) => Number(m[1]));
    if (matches.length) counts[key] = matches;
  }
  if (!Object.values(counts).some((v) => (v as number[]).some((n) => n > 0)))
    throw Error("Native test inventory is unrecognized or empty");
  return counts;
}
