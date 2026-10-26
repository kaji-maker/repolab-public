import { mkdir, open, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { z } from "zod";
import { sandboxConfigFromEnv } from "./nebius.ts";
import {
  auditVueNativeFreeze,
  vueNativeRequest,
  parseVueNativeReceipt,
  shaVueNative,
  type VueNativeSlot,
} from "../evaluation/vue-native-v3.ts";

// v3 fixed original baseline only. This client accepts neither candidate bytes nor commands.
export class VueNativeSandbox {
  private config = sandboxConfigFromEnv();
  private files: Record<string, unknown> = {};
  private directory: string;
  constructor(directory: string) {
    this.directory = directory;
  }
  private async request(route: string, init: RequestInit = {}) {
    if (
      !this.config.token ||
      !this.config.project ||
      !this.config.coverageConfirmed
    )
      throw Error("Sandbox credentials or coverage confirmation missing");
    const url = new URL(this.config.baseUrl);
    if (url.href !== "https://api.tokenfactory.nebius.com/sandboxes/")
      throw Error("Native Sandbox endpoint changed");
    const r = await fetch(new URL("v1/" + route, url), {
      ...init,
      headers: {
        Authorization: "Bearer " + this.config.token,
        Project: this.config.project,
        ...init.headers,
      },
      redirect: "error",
      signal: AbortSignal.timeout(30000),
    });
    if (!r.ok)
      throw Error("Native Sandbox HTTP " + r.status + "; no POST retry");
    return r;
  }
  async upload() {
    auditVueNativeFreeze();
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const uploads: [string, string][] = [
      ["repositories/vue-native-v1/original.tar.gz", "upstream.tar.gz"],
      ["fixtures/vue-native/original-manifest.json", "manifest.json"],
      ["repositories/vue-native-v3/guest.cjs", "guest.cjs"],
      ["repositories/vue-native-v1/reproduction.cjs", "reproduction.cjs"],
    ];
    for (const [source, target] of uploads) {
      const bytes = readFileSync(source);
      if (bytes.length > 2097152)
        throw Error("Vue native upload exceeds fixed cap");
      const record: Record<string, unknown> = {
        source,
        target,
        sha256: shaVueNative(bytes),
        bytes: bytes.length,
        status: "SUBMITTING",
        inference: "none",
        execution: "nebius-sandbox",
      };
      const dest = join(this.directory, "upload-" + target + ".json");
      const f = await open(dest, "wx", 0o600);
      await f.writeFile(JSON.stringify(record));
      await f.close();
      try {
        const r = z
          .object({
            uuid: z.uuid(),
            sha256: z.string(),
            size: z.number().int(),
          })
          .parse(
            await (
              await this.request("files", {
                method: "POST",
                headers: { "Content-Type": "application/octet-stream" },
                body: new Uint8Array(bytes),
              })
            ).json(),
          );
        Object.assign(record, { response: r });
        if (r.sha256 !== record.sha256 || ![-1, bytes.length].includes(r.size))
          throw Error("Vue native upload identity changed");
        this.files["/opt/repolab/native/" + target] = {
          uuid: r.uuid,
          uid: 0,
          gid: 0,
          mode: "0444",
        };
        record.status = "VERIFIED";
      } catch (e) {
        record.status = "FAILED";
        record.error =
          e instanceof Error ? e.message : "Vue native upload failed";
        throw e;
      } finally {
        await writeFile(dest, JSON.stringify(record, null, 2) + "\n", {
          mode: 0o600,
        });
      }
    }
  }
  async run(slot: VueNativeSlot, image: string) {
    auditVueNativeFreeze();
    const request = vueNativeRequest(
      slot,
      image,
      slot === "prepare" ? this.files : {},
    );
    if (slot === "prepare" && Object.keys(this.files).length !== 4)
      throw Error("Vue native files not staged");
    const record: Record<string, unknown> = {
      slot,
      request,
      status: "SUBMITTING",
      startedAt: new Date().toISOString(),
      inference: "none",
      execution: "nebius-sandbox",
    };
    const dest = join(this.directory, slot + ".json");
    const f = await open(dest, "wx", 0o600);
    await f.writeFile(JSON.stringify(record));
    await f.close();
    const save = () =>
      writeFile(dest, JSON.stringify(record, null, 2) + "\n", { mode: 0o600 });
    let id: string | undefined;
    let terminal = false;
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
        throw Error("Vue native operation Location mismatch");
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
          throw Error("Vue native operation identity mismatch");
        if (["PENDING", "ASSIGNED", "EXECUTING"].includes(identity.status)) {
          await sleep(1000);
          continue;
        }
        terminal = true;
        const result = parseVueNativeReceipt(raw, slot, id, image);
        record.completedAt = new Date().toISOString();
        record.receiptValidated = true;
        await save();
        return result;
      }
      throw Error("Vue native operation polling deadline");
    } catch (e) {
      record.error =
        e instanceof Error ? e.message : "Vue native operation unavailable";
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
