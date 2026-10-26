import { readFileSync } from "node:fs";
import { mkdir, open, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { z } from "zod";
import type { SandboxConfig } from "./nebius.ts";
import { shaNative } from "../evaluation/preact-native-v5.ts";
import { trialInput } from "./preact-trial-v10.ts";
import {
  admissionRequest,
  parseAdmissionReceipt,
} from "./preact-admission-v5.ts";
import { auditPreactProduct } from "../repositories/preact-product-protocol-v1.ts";
import { assertNativeNoSecrets } from "../repositories/preact-pack-v1.ts";
export function replayInput(proposal: unknown) {
  const input = trialInput(proposal),
    files = { ...input.files };
  const manifest = JSON.parse(
    files["/opt/repolab/native/admission-manifest.json"].toString(),
  );
  manifest.format = "repolab-preact-replay-input/v1";
  manifest.execution =
    proposal === null
      ? "Reviewed original; native pack replay in Sandbox only"
      : "Previously selected model-generated source; zero-inference native pack replay in Sandbox only";
  files["/opt/repolab/native/admission-manifest.json"] = Buffer.from(
    JSON.stringify(manifest),
  );
  return { files, sourceHash: input.sourceHash };
}
export interface NativeRemote {
  upload(path: string, bytes: Buffer, name: string): Promise<unknown>;
  run(
    variant: string,
    stage: string,
    image: string,
    hash: string,
    files: Record<string, unknown>,
  ): Promise<ReturnType<typeof parseAdmissionReceipt>>;
}
export class NativeReplaySandbox {
  private config: SandboxConfig;
  private signal: AbortSignal;
  private directory: string;
  private variant: string;
  private sourceHash: string;
  constructor(
    directory: string,
    variant: "original" | "selected",
    proposal: unknown,
    config: SandboxConfig,
    signal: AbortSignal,
  ) {
    this.directory = directory;
    this.variant = variant;
    this.config = config;
    this.signal = signal;
    this.sourceHash = replayInput(proposal).sourceHash;
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
      signal:
        init.method === "DELETE"
          ? AbortSignal.timeout(15000)
          : AbortSignal.any([AbortSignal.timeout(15000), this.signal]),
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
    assertNativeNoSecrets(bytes.toString("utf8"));
    auditPreactProduct();
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const dest = join(this.directory, "upload-" + recordName + ".json");
    const record: Record<string, unknown> = {
      path,
      sha256: shaNative(bytes),
      bytes: bytes.length,
      status: "SUBMITTING",
      startedAt: new Date().toISOString(),
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
    auditPreactProduct();
    this.signal.throwIfAborted();
    const request = admissionRequest(stage, image, files);
    const dest = join(this.directory, variant + "-" + stage + ".json");
    const record: Record<string, unknown> = {
      variant,
      stage,
      request,
      sourceHash,
      inference: "none (native pack replay)",
      execution:
        variant === "original"
          ? "nebius-sandbox; reviewed original"
          : "nebius-sandbox; replay of selected model-generated scoped candidate",
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
        this.signal.throwIfAborted();
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
          await sleep(1000, undefined, { signal: this.signal });
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
