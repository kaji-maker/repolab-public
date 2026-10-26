import { existsSync, readFileSync, readdirSync } from "node:fs";
import { mkdir, writeFile, rename, unlink } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import type { SandboxConfig } from "./nebius.ts";
import { acquireRepairLease } from "../repositories/repair-lease.ts";
import { acquireRecoveryLease } from "./recovery-lease-v1.ts";
import { readLedgerStatus } from "../storage/reconciliation.ts";
import {
  auditVueHardening,
  vueHash,
  vueHardeningRequest,
  vueHardeningSlots,
  parseVueHardeningReceipt,
  VUE_HARDENING_IMAGE,
  type VueHardeningSlot,
} from "../evaluation/vue-hardening-v1.ts";

const terminal = new Set(["SUCCESS", "FAILED", "CANCELLED"]);
const active = new Set(["PENDING", "ASSIGNED", "EXECUTING"]);
const read = (path: string) => JSON.parse(readFileSync(path, "utf8"));
async function atomic(path: string, value: unknown) {
  const temp = path + "." + randomUUID() + ".tmp";
  await writeFile(temp, JSON.stringify(value) + "\n", {
    flag: "wx",
    mode: 0o600,
  });
  await rename(temp, path);
}
const uploads = [
  ["repositories/vue-hardening-v1/guest.cjs", "guest.cjs"],
  ["repositories/vue-hardening-v1/run-unit.mjs", "run-unit.mjs"],
] as const;

/** Original-only closed qualification. Recovery only reconciles execution; it never resumes a run. */
export class VueHardeningSandbox {
  readonly execution: string;
  private directory: string;
  private root: string;
  private config: SandboxConfig;
  private signal: AbortSignal;
  private fetcher: typeof fetch;
  private simulation: boolean;
  constructor(
    directory: string,
    config: SandboxConfig,
    signal: AbortSignal,
    simulation?: { root: string; fetch: typeof fetch },
  ) {
    this.directory = directory;
    this.config = config;
    this.signal = signal;
    this.root = simulation?.root ?? ".repolab";
    this.fetcher = simulation?.fetch ?? fetch;
    this.execution = simulation
      ? "simulation; source was not executed"
      : "nebius-sandbox; reviewed original";
    this.simulation = !!simulation;
  }
  private checkLedger() {
    if (this.simulation) return;
    const ledger = readLedgerStatus(".repolab/state.sqlite");
    if (!ledger.exists || ledger.blocked)
      throw Error("Known settled inference ledger required");
  }
  private safe(value: unknown) {
    const text = JSON.stringify(value);
    for (const secret of [this.config.token, this.config.project])
      if (secret && text.includes(secret))
        throw Error("Credential excluded from artifact");
  }
  private async http(
    route: string,
    init: RequestInit = {},
    signal = this.signal,
  ): Promise<Response> {
    signal.throwIfAborted();
    if (
      !this.config.token ||
      !this.config.project ||
      !this.config.coverageConfirmed ||
      this.config.baseUrl !== "https://api.tokenfactory.nebius.com/sandboxes/"
    )
      throw Error("Qualified Sandbox configuration required");
    const r = await this.fetcher(new URL("v1/" + route, this.config.baseUrl), {
      ...init,
      redirect: "error",
      headers: {
        Authorization: "Bearer " + this.config.token,
        Project: this.config.project,
        ...init.headers,
      },
      signal: AbortSignal.any([signal, AbortSignal.timeout(30000)]),
    });
    if (!r.ok) throw Error("Sandbox request failed; no automatic retry");
    return r;
  }
  async begin() {
    auditVueHardening();
    this.signal.throwIfAborted();
    this.checkLedger();
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    if (existsSync(join(this.directory, "binding.json")))
      throw Error("Qualification already started; no rerun");
    const id = "vue-hardening-" + randomUUID(),
      roots = [this.root, join(this.root, "repositories")];
    const release = await acquireRepairLease(roots[0], id);
    try {
      await acquireRepairLease(roots[1], id);
    } catch (e) {
      await release();
      throw e;
    }
    // On any later persistence failure retain both leases: do not guess whether dispatch occurred.
    const leases = roots.map((root) => ({
      path: join(root, "clsx-repair.lock"),
      bytes: readFileSync(join(root, "clsx-repair.lock"), "utf8"),
    }));
    await writeFile(
      join(this.directory, "binding.json"),
      JSON.stringify({ id, execution: this.execution, leases }) + "\n",
      { flag: "wx", mode: 0o600 },
    );
  }
  private binding() {
    const b = read(join(this.directory, "binding.json"));
    const roots = [this.root, join(this.root, "repositories")];
    if (
      b.execution !== this.execution ||
      !Array.isArray(b.leases) ||
      b.leases.length !== 2 ||
      b.leases.some(
        (l: any, i: number) =>
          l.path !== join(roots[i], "clsx-repair.lock") ||
          typeof l.bytes !== "string" ||
          JSON.parse(l.bytes).runId !== b.id,
      )
    )
      throw Error("Workflow lease binding changed");
    return b;
  }
  private assertLeases() {
    const b = this.binding();
    for (const l of b.leases)
      if (readFileSync(l.path, "utf8") !== l.bytes)
        throw Error("Workflow lease changed");
    return b;
  }
  async upload() {
    this.assertLeases();
    this.signal.throwIfAborted();
    auditVueHardening();
    if (existsSync(join(this.directory, "active-execution.json")))
      throw Error("Unresolved execution blocks uploads");
    const files: Record<string, unknown> = {};
    for (const [source, name] of uploads) {
      const bytes = readFileSync(source);
      this.safe(bytes.toString("utf8"));
      const dest = join(this.directory, "upload-" + name + ".json");
      const record: any = {
        source,
        name,
        sha256: vueHash(bytes),
        bytes: bytes.length,
        status: "SUBMITTING",
        execution: this.execution,
        inference: "none",
      };
      await writeFile(dest, JSON.stringify(record), {
        flag: "wx",
        mode: 0o600,
      });
      try {
        const raw = await (
          await this.http("files", {
            method: "POST",
            headers: { "Content-Type": "application/octet-stream" },
            body: new Uint8Array(bytes),
          })
        ).json();
        this.safe(raw);
        const f = z
          .object({
            uuid: z.uuid(),
            sha256: z.literal(record.sha256),
            size: z.number().int(),
          })
          .parse(raw);
        if (![-1, bytes.length].includes(f.size))
          throw Error("Upload size changed");
        record.response = f;
        record.status = "VERIFIED";
        files["/opt/repolab/hardening/" + name] = {
          uuid: f.uuid,
          uid: 0,
          gid: 0,
          mode: "0444",
        };
      } catch {
        record.status = "UNKNOWN";
        throw Error("Upload failed; inspect slot without retry");
      } finally {
        await atomic(dest, record);
      }
    }
    return files;
  }
  private checkFiles(files: Record<string, unknown>) {
    const expected: Record<string, unknown> = {};
    for (const [source, name] of uploads) {
      const u = read(join(this.directory, "upload-" + name + ".json"));
      if (
        u.status !== "VERIFIED" ||
        u.source !== source ||
        u.sha256 !== vueHash(readFileSync(source)) ||
        u.response.sha256 !== u.sha256
      )
        throw Error("Upload binding changed");
      expected["/opt/repolab/hardening/" + name] = {
        uuid: z.uuid().parse(u.response.uuid),
        uid: 0,
        gid: 0,
        mode: "0444",
      };
    }
    if (!isDeepStrictEqual(files, expected))
      throw Error("Closed original uploads required");
  }
  private history() {
    const result: any[] = [];
    for (const slot of vueHardeningSlots) {
      const p = join(this.directory, slot + ".json");
      if (!existsSync(p)) break;
      result.push(read(p));
    }
    return result;
  }
  private terminalRecord(r: any) {
    return (
      r.latest?.uuid === r.id &&
      r.latest?.image_uuid === r.request.image &&
      terminal.has(r.latest?.status)
    );
  }
  async run(
    slot: VueHardeningSlot,
    image: string,
    files: Record<string, unknown> = {},
  ) {
    auditVueHardening();
    this.signal.throwIfAborted();
    this.assertLeases();
    this.checkLedger();
    if (existsSync(join(this.directory, "active-execution.json")))
      throw Error("Unresolved execution blocks dispatch");
    const past = this.history();
    if (vueHardeningSlots[past.length] !== slot)
      throw Error("Consumed or out-of-order qualification slot");
    for (const r of past) {
      if (
        r.receiptValidated !== true ||
        !this.terminalRecord(r) ||
        r.latest.status !== "SUCCESS"
      )
        throw Error("Prior qualification gate failed");
      parseVueHardeningReceipt(r.latest, r.slot, r.id, r.request.image);
    }
    const expectedImage = past.length
      ? past[0].latest.result_image_uuid
      : VUE_HARDENING_IMAGE;
    if (image !== expectedImage)
      throw Error("Qualification image lineage changed");
    if (slot === "harden") this.checkFiles(files);
    const request = vueHardeningRequest(slot, image, files);
    this.safe(request);
    const dest = join(this.directory, slot + ".json"),
      lock = join(this.directory, "active-execution.json");
    const owner = {
      slot,
      nonce: randomUUID(),
      requestSha256: vueHash(JSON.stringify(request)),
    };
    const record: any = {
      slot,
      request,
      owner,
      state: "DISPATCHING",
      execution: this.execution,
      inference: "none",
    };
    await writeFile(lock, JSON.stringify(owner), { flag: "wx", mode: 0o600 });
    await writeFile(dest, JSON.stringify(record), { flag: "wx", mode: 0o600 });
    try {
      const response = await this.http("instances", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(request),
      });
      const body = await response.json();
      this.safe(body);
      record.id = z.object({ uuid: z.uuid() }).parse(body).uuid;
      await atomic(dest, record); // Durable ID before any header validation or polling.
      const location = response.headers.get("Location");
      if (
        location &&
        new URL(location, this.config.baseUrl).href !==
          new URL("v1/operations/" + record.id, this.config.baseUrl).href
      )
        throw Error("Operation Location mismatch");
      for (let attempt = 0; attempt < 120; attempt++) {
        const raw = await (await this.http("operations/" + record.id)).json();
        this.safe(raw);
        record.latest = raw;
        await atomic(dest, record);
        if (raw.uuid !== record.id || raw.image_uuid !== image)
          throw Error("Operation identity mismatch");
        if (terminal.has(raw.status)) {
          record.state = "TERMINAL";
          await atomic(dest, record);
          const result = parseVueHardeningReceipt(raw, slot, record.id, image);
          if (
            past.length &&
            result.guest.configSha256 !==
              parseVueHardeningReceipt(
                past[0].latest,
                "harden",
                past[0].id,
                VUE_HARDENING_IMAGE,
              ).guest.configSha256
          )
            throw Error("Resolved native config identity changed");
          record.receiptValidated = true;
          await atomic(dest, record);
          await this.releaseActive(owner);
          return result;
        }
        if (!active.has(raw.status))
          throw Error("Unrecognized provider status");
        await new Promise<void>((resolve, reject) => {
          const abort = () => {
            clearTimeout(timer);
            reject(Error("Polling interrupted"));
          };
          const timer = setTimeout(() => {
            this.signal.removeEventListener("abort", abort);
            resolve();
          }, 5000);
          this.signal.addEventListener("abort", abort, { once: true });
          if (this.signal.aborted) abort();
        });
      }
      throw Error("Polling deadline");
    } catch {
      record.state = this.terminalRecord(record) ? "TERMINAL" : "UNKNOWN";
      record.failure = "execution_or_admission_failed";
      await atomic(dest, record);
      if (record.state === "TERMINAL") await this.releaseActive(owner);
      else
        await atomic(lock, {
          ...owner,
          rawSha256: vueHash(readFileSync(dest)),
        });
      throw Error(
        "Vue qualification stopped; inspect durable evidence and recover uncertainty",
      );
    }
  }
  private async releaseActive(owner: unknown) {
    const path = join(this.directory, "active-execution.json");
    const { rawSha256, ...actual } = read(path);
    if (!isDeepStrictEqual(actual, owner))
      throw Error("Execution lock changed");
    await unlink(path);
  }
  /** A cancellation response never proves terminal state and never releases leases. */
  async cancel(signal: AbortSignal) {
    auditVueHardening();
    this.assertLeases();
    const { rawSha256, ...owner } = read(
      join(this.directory, "active-execution.json"),
    );
    const raw = read(join(this.directory, owner.slot + ".json"));
    const id = z.uuid().parse(raw.id);
    if (!isDeepStrictEqual(owner, raw.owner))
      throw Error("Cancellation binding changed");
    if (
      rawSha256 &&
      rawSha256 !==
        vueHash(readFileSync(join(this.directory, owner.slot + ".json")))
    )
      throw Error("Raw evidence changed");
    const r = await this.http("operations/" + id, { method: "DELETE" }, signal);
    await writeFile(
      join(this.directory, "cancellation-" + owner.nonce + ".json"),
      JSON.stringify({ id, requestAccepted: r.ok, terminalConfirmed: false }),
      { flag: "wx", mode: 0o600 },
    );
    return { state: "UNKNOWN", verified: false };
  }
  async recover(signal: AbortSignal) {
    const release = await acquireRecoveryLease(
      join(this.directory, "recovery.sqlite"),
    );
    try {
      auditVueHardening();
      signal.throwIfAborted();
      const lock = join(this.directory, "active-execution.json");
      if (!existsSync(lock)) {
        await this.finish();
        return { state: "TERMINAL", verified: false };
      }
      this.assertLeases();
      const { rawSha256, ...owner } = read(lock),
        path = join(this.directory, owner.slot + ".json"),
        r = read(path);
      z.enum(vueHardeningSlots).parse(r.slot);
      if (
        !isDeepStrictEqual(owner, r.owner) ||
        owner.requestSha256 !== vueHash(JSON.stringify(r.request)) ||
        (rawSha256 && rawSha256 !== vueHash(readFileSync(path))) ||
        !isDeepStrictEqual(
          r.request,
          vueHardeningRequest(r.slot, r.request.image, r.request.files),
        ) ||
        r.execution !== this.execution
      )
        throw Error("Recovery binding changed");
      // Lost submission without ID requires external reconciliation; never guess or repeat POST.
      const id = z.uuid().parse(r.id),
        originalHash = vueHash(readFileSync(path));
      const raw = await (
        await this.http("operations/" + id, {}, signal)
      ).json();
      this.safe(raw);
      if (raw.uuid !== id || raw.image_uuid !== r.request.image)
        throw Error("Recovery identity changed");
      const state = terminal.has(raw.status) ? "TERMINAL" : "UNKNOWN";
      await writeFile(
        join(
          this.directory,
          "recovery-" + owner.nonce + "-" + randomUUID() + ".json",
        ),
        JSON.stringify({ owner, raw, originalHash, state, verified: false }),
        { flag: "wx", mode: 0o600 },
      );
      if (state === "TERMINAL") {
        if (vueHash(readFileSync(path)) !== originalHash)
          throw Error("Raw evidence changed during recovery");
        await this.releaseActive(owner);
        await this.finish();
      }
      return { state, verified: false };
    } finally {
      await release();
    }
  }
  async finish() {
    const b = this.binding();
    if (existsSync(join(this.directory, "active-execution.json")))
      throw Error("Unknown execution retains shared leases");
    for (const r of this.history()) {
      if (
        r.owner?.requestSha256 !== vueHash(JSON.stringify(r.request)) ||
        !isDeepStrictEqual(
          r.request,
          vueHardeningRequest(r.slot, r.request.image, r.request.files),
        ) ||
        r.execution !== this.execution
      )
        throw Error("Qualification history changed");
      if (this.terminalRecord(r)) continue;
      const recovered = readdirSync(this.directory)
        .filter((n) => n.startsWith("recovery-" + r.owner.nonce + "-"))
        .some((n) => {
          const x = read(join(this.directory, n));
          return (
            x.state === "TERMINAL" &&
            x.verified === false &&
            isDeepStrictEqual(x.owner, r.owner) &&
            x.originalHash ===
              vueHash(readFileSync(join(this.directory, r.slot + ".json"))) &&
            x.raw?.uuid === r.id &&
            x.raw?.image_uuid === r.request.image &&
            terminal.has(x.raw?.status)
          );
        });
      if (!recovered)
        throw Error("Unresolved execution journal retains leases");
    }
    // Validate both before removing either; supports restart after a partial terminal release.
    for (const l of b.leases)
      if (existsSync(l.path) && readFileSync(l.path, "utf8") !== l.bytes)
        throw Error("Shared lease changed");
    for (const l of b.leases) if (existsSync(l.path)) await unlink(l.path);
  }
}
