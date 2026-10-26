import { readFileSync } from "node:fs";
import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import { shaNative } from "./preact-native-v5.ts";
import {
  admissionRequest,
  ADMISSION_PARENT,
} from "../execution/preact-admission-v5.ts";
import { trialInput } from "../execution/preact-trial-v10.ts";
import {
  auditFreshPreact,
  REPAIR_FREEZE,
} from "../repositories/preact-repair-protocol-v3.ts";
export const PREACT_GUARD_LIVE_FREEZE: string = "9b2bb81ff1d39b900a11d2c60ef88e8b42c9fe752d75ed1d55a5052c7bb60998";
export const liveSettings = {
  format: "repolab-preact-guard-live-qualification/v1",
  productFreeze: REPAIR_FREEZE,
  workflowId: "f2955074-c7e7-4261-81ff-c2feedec0dfc",
  image: ADMISSION_PARENT,
  sourceHash:
    "5a9ae127c966ff9e82bf5e567c8822250c8a01456d537b533c7e351e7aa4a566",
  maxModelCalls: 0,
  maxSandboxOperations: 2,
  maxOperationReads: 120,
  maxDeletes: 2,
  stages: ["public-A", "public-B"],
  maxRecoveryAttempts: 20,
  retryQualification: false,
  scope:
    "Original-only qualification envelope, production guard and default recovery API; not fresh model repair orchestration or accuracy",
};
export const liveAssets = [
  "packages/evaluation/preact-guard-live-v1.ts",
  "apps/evaluator/preact-guard-live-v1.ts",
  "tests/preact-guard-live-v1.test.ts",
  "evaluation/PREACT_GUARD_LIVE_V1.md",
  "evaluation/preact-product-repair-v3.json",
];
export function liveBytes(path: string) {
  const bytes = readFileSync(path);
  return path === liveAssets[0]
    ? Buffer.from(
        bytes
          .toString()
          .replace(PREACT_GUARD_LIVE_FREEZE, "__PREACT_GUARD_LIVE_FREEZE__"),
      )
    : bytes;
}
export function auditPreactGuardLive(reader = liveBytes) {
  auditFreshPreact();
  if (PREACT_GUARD_LIVE_FREEZE === "__UNFROZEN__")
    throw Error("Live qualification is not frozen");
  const p = JSON.parse(
    readFileSync("evaluation/preact-guard-live-v1.json", "utf8"),
  );
  const { digest, assets, uploads, ...settings } = p;
  const input = trialInput(null),
    expectedUploads = Object.entries(input.files).map(([path, bytes]) => ({
      path,
      sha256: shaNative(bytes),
      bytes: bytes.length,
    }));
  if (
    digest !== PREACT_GUARD_LIVE_FREEZE ||
    !isDeepStrictEqual(settings, liveSettings) ||
    input.sourceHash !== settings.sourceHash ||
    !isDeepStrictEqual(uploads, expectedUploads) ||
    digest !== shaNative(JSON.stringify({ ...settings, uploads, assets })) ||
    assets.length !== liveAssets.length ||
    assets.some(
      (a: any, i: number) =>
        a.path !== liveAssets[i] || a.sha256 !== shaNative(reader(a.path)),
    )
  )
    throw Error("Live Preact qualification freeze changed");
  return p;
}
/** Network admission, not a simulated executor: admitted calls reach the supplied real transport unchanged. */
export class OriginalOnlyPreactTransport {
  private remote: typeof fetch;
  private signal: AbortSignal;
  private uploads = new Map<string, string>();
  private submittedHashes = new Set<string>();
  private ids = new Set<string>();
  private files: Record<string, unknown> | null = null;
  private expected = Object.entries(trialInput(null).files).map(
    ([path, bytes]) => ({
      path,
      sha256: shaNative(bytes),
      bytes: bytes.length,
    }),
  );
  private counts = { uploads: 0, compute: 0, reads: 0, deletes: 0, denied: 0 };
  constructor(remote: typeof fetch, signal: AbortSignal) {
    this.remote = remote;
    this.signal = signal;
  }
  snapshot() {
    return { ...this.counts, modelCalls: 0 };
  }
  bindFiles(files: Record<string, any>) {
    if (
      this.files ||
      this.counts.compute ||
      this.uploads.size !== this.expected.length ||
      !isDeepStrictEqual(
        Object.keys(files).sort(),
        this.expected.map((x) => x.path).sort(),
      )
    )
      throw Error("Original uploads incomplete or already bound");
    for (const row of this.expected) {
      const handle = files[row.path];
      if (
        !handle ||
        this.uploads.get(handle.uuid) !== row.sha256 ||
        handle.uid !== 0 ||
        handle.gid !== 0 ||
        handle.mode !== "0444" ||
        Object.keys(handle).sort().join(",") !== "gid,mode,uid,uuid"
      )
        throw Error("Original upload binding changed");
    }
    this.files = structuredClone(files);
  }
  fetch: typeof fetch = async (url, init = {}) => {
    this.signal.throwIfAborted();
    const u = new URL(String(url)),
      method = init.method ?? "GET";
    let route: "upload" | "compute" | "read" | "delete",
      hash = "";
    try {
      if (
        u.origin !== "https://api.tokenfactory.nebius.com" ||
        u.search ||
        u.hash ||
        u.username ||
        u.password ||
        init.redirect !== "error"
      )
        throw Error();
      if (u.pathname === "/sandboxes/v1/files" && method === "POST") {
        if (this.files || !(init.body instanceof Uint8Array)) throw Error();
        const bytes = Buffer.from(init.body);
        hash = shaNative(bytes);
        if (
          !this.expected.some(
            (x) => x.sha256 === hash && x.bytes === bytes.length,
          ) ||
          this.submittedHashes.has(hash)
        )
          throw Error();
        this.submittedHashes.add(hash);
        this.counts.uploads++;
        route = "upload";
      } else if (
        u.pathname === "/sandboxes/v1/instances" &&
        method === "POST"
      ) {
        if (
          !this.files ||
          this.counts.compute >= liveSettings.maxSandboxOperations ||
          typeof init.body !== "string" ||
          !isDeepStrictEqual(
            JSON.parse(init.body),
            admissionRequest("public-A", liveSettings.image, this.files),
          )
        )
          throw Error();
        this.counts.compute++;
        route = "compute";
      } else {
        const m = u.pathname.match(
          /^\/sandboxes\/v1\/operations\/([0-9a-f-]+)$/,
        );
        if (!m || !this.ids.has(m[1])) throw Error();
        if (
          method === "GET" &&
          this.counts.reads < liveSettings.maxOperationReads
        ) {
          this.counts.reads++;
          route = "read";
        } else if (
          method === "DELETE" &&
          this.counts.deletes < liveSettings.maxDeletes
        ) {
          this.counts.deletes++;
          route = "delete";
        } else throw Error();
      }
    } catch {
      this.counts.denied++;
      throw Error(
        "Original-only qualification network policy rejected request",
      );
    }
    const response = await this.remote(url, {
      ...init,
      signal: AbortSignal.any([
        this.signal,
        ...(init.signal ? [init.signal] : []),
      ]),
    });
    if (response.ok && (route === "upload" || route === "compute")) {
      const raw = await response.clone().json(),
        id = z.uuid().parse(raw.uuid);
      if (route === "upload") {
        if (raw.sha256 !== hash) throw Error("Upload response hash changed");
        this.uploads.set(id, hash);
      } else this.ids.add(id);
    }
    return response;
  };
}
