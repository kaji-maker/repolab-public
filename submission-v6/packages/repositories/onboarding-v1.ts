import { createHash } from "node:crypto";
import { gunzipSync } from "node:zlib";
import { isDeepStrictEqual } from "node:util";
import ts from "typescript";
export const onboardingSha = (bytes: string | Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");
export type SourcePin = {
  repository: string;
  commit: string;
  archiveRoot: string;
  archiveSha256: string;
  files: {
    path: string;
    sha256: string;
    bytes: number;
    gitBlobSha1?: string;
  }[];
};
export type ReviewedOnboardingProfile = {
  id: string;
  repository: string;
  commit: string;
  packageSha256: string;
  editablePaths: string[];
  generatedPaths: string[];
  scripts: Record<string, string>;
  runtime: { native: string; observations: string; rationale: string };
};
export function closedRepositoryPath(path: string) {
  if (
    !path ||
    path.length > 240 ||
    !/^[A-Za-z0-9._/@+-]+$/.test(path) ||
    path.startsWith("/") ||
    path
      .split("/")
      .some(
        (part) =>
          !part ||
          [".", "..", ".git", "node_modules"].includes(part) ||
          /^\.env(?:\.|$)|^id_(?:rsa|ed25519)$|\.(?:pem|key)$/i.test(part),
      )
  )
    throw Error("Unsafe repository path");
  return path;
}
/** GitHub tar subset only, in memory. No extraction, shell, import, installation or source execution. */
export function readPinnedRepositoryArchive(bytes: Buffer, pin: SourcePin) {
  if (
    !/^[a-f0-9]{40}$/.test(pin.commit) ||
    !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(pin.repository) ||
    onboardingSha(bytes) !== pin.archiveSha256 ||
    bytes.length > 8_000_000 ||
    pin.files.length < 1 ||
    pin.files.length > 10000
  )
    throw Error("Pinned archive identity changed");
  closedRepositoryPath(pin.archiveRoot);
  const data = gunzipSync(bytes, { maxOutputLength: 32_000_000 }),
    files = new Map<string, Buffer>(),
    seen = new Set<string>();
  const text = (b: Buffer) =>
    new TextDecoder("utf-8", { fatal: true }).decode(
      b.subarray(0, b.indexOf(0) < 0 ? b.length : b.indexOf(0)),
    );
  const oct = (b: Buffer) => {
    const s = text(b).trim();
    if (!/^[0-7]+$/.test(s)) throw Error("Unsupported archive number");
    const n = parseInt(s, 8);
    if (!Number.isSafeInteger(n)) throw Error("Archive size overflow");
    return n;
  };
  let offset = 0,
    ended = false,
    globalComment = false;
  while (offset + 512 <= data.length) {
    const h = data.subarray(offset, offset + 512);
    if (h.every((n) => n === 0)) {
      if (
        data.length - offset < 1024 ||
        !data.subarray(offset).every((n) => n === 0)
      )
        throw Error("Invalid archive trailer");
      ended = true;
      break;
    }
    const checksum = oct(h.subarray(148, 156));
    let sum = 0;
    for (let i = 0; i < 512; i++) sum += i >= 148 && i < 156 ? 32 : h[i];
    if (sum !== checksum || text(h.subarray(257, 263)) !== "ustar")
      throw Error("Archive checksum or format mismatch");
    const size = oct(h.subarray(124, 136)),
      type = String.fromCharCode(h[156] || 48),
      mode = oct(h.subarray(100, 108));
    if (
      size > 4_000_000 ||
      mode > 0o777 ||
      offset + 512 + Math.ceil(size / 512) * 512 > data.length
    )
      throw Error("Archive entry exceeds bounds");
    const body = data.subarray(offset + 512, offset + 512 + size);
    if (
      !data
        .subarray(
          offset + 512 + size,
          offset + 512 + Math.ceil(size / 512) * 512,
        )
        .every((n) => n === 0)
    )
      throw Error("Nonzero archive padding");
    offset += 512 + Math.ceil(size / 512) * 512;
    if (type === "g") {
      if (globalComment || seen.size || size > 256)
        throw Error("Unsupported global archive metadata");
      const value = new TextDecoder("utf-8", { fatal: true }).decode(body),
        m = value.match(/^(\d+) comment=([a-f0-9]{40})\n$/);
      if (!m || Number(m[1]) !== body.length || m[2] !== pin.commit)
        throw Error("Archive commit metadata changed");
      globalComment = true;
      continue;
    }
    if (!["0", "5"].includes(type) || text(h.subarray(157, 257)))
      throw Error("Links, devices and archive path overrides are unsupported");
    const prefix = text(h.subarray(345, 500)),
      name = (prefix ? prefix + "/" : "") + text(h.subarray(0, 100));
    const clean = type === "5" ? name.replace(/\/$/, "") : name;
    closedRepositoryPath(clean);
    if (clean !== pin.archiveRoot && !clean.startsWith(pin.archiveRoot + "/"))
      throw Error("Archive root changed");
    const path =
      clean === pin.archiveRoot ? "" : clean.slice(pin.archiveRoot.length + 1);
    if (seen.has(clean.toLowerCase()))
      throw Error("Duplicate or case-colliding archive path");
    seen.add(clean.toLowerCase());
    if (type === "5") {
      if (size) throw Error("Directory has archive payload");
      continue;
    }
    if (!path) throw Error("Archive root must be a directory");
    files.set(path, Buffer.from(body));
  }
  for (const path of files.keys())
    for (let i = 1; i < path.split("/").length; i++)
      if (files.has(path.split("/").slice(0, i).join("/")))
        throw Error("Archive regular file shadows a directory");
  if (!ended || !globalComment || files.size !== pin.files.length)
    throw Error("Archive inventory incomplete");
  const pins = new Set<string>();
  for (const f of pin.files) {
    closedRepositoryPath(f.path);
    if (pins.has(f.path) || !Number.isSafeInteger(f.bytes) || f.bytes < 0)
      throw Error("Invalid pinned inventory");
    pins.add(f.path);
    const body = files.get(f.path);
    if (!body || body.length !== f.bytes || onboardingSha(body) !== f.sha256)
      throw Error("Pinned source file changed");
    if (
      f.gitBlobSha1 &&
      createHash("sha1")
        .update(`blob ${body.length}\0`)
        .update(body)
        .digest("hex") !== f.gitBlobSha1
    )
      throw Error("Git blob identity changed");
  }
  return files;
}
function packageData(bytes: Buffer) {
  if (bytes.length > 1_000_000) throw Error("Package metadata exceeds bounds");
  const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes),
    ast = ts.parseJsonText("package.json", text);
  if ((ast as any).parseDiagnostics.length) throw Error("Invalid package JSON");
  const walk = (node: ts.Node) => {
    if (ts.isObjectLiteralExpression(node)) {
      const keys = new Set<string>();
      for (const p of node.properties) {
        if (!ts.isPropertyAssignment(p) || !ts.isStringLiteral(p.name))
          throw Error("Invalid package property");
        const key = p.name.text;
        if (
          keys.has(key) ||
          ["__proto__", "prototype", "constructor"].includes(key)
        )
          throw Error("Duplicate or unsafe package property");
        keys.add(key);
      }
    }
    ts.forEachChild(node, walk);
  };
  walk(ast);
  const value = JSON.parse(text);
  if (!value || Array.isArray(value) || typeof value !== "object")
    throw Error("Package must be an object");
  return value;
}
/** Discovery remains data. Only an independently reviewed exact profile can authorize a later Sandbox plan. */
export function inspectPinnedRepository(
  bytes: Buffer,
  pin: SourcePin,
  profile?: ReviewedOnboardingProfile,
) {
  const files = readPinnedRepositoryArchive(bytes, pin),
    pkgBytes = files.get("package.json");
  if (!pkgBytes) throw Error("Root package metadata missing");
  const pkg = packageData(pkgBytes),
    issues: string[] = [],
    entries = new Set<string>();
  const entry = (value: unknown) => {
    if (typeof value !== "string") throw Error("Unsupported package entry");
    entries.add(
      closedRepositoryPath(value.startsWith("./") ? value.slice(2) : value),
    );
  };
  for (const key of ["main", "module", "types", "typings", "unpkg"])
    if (pkg[key] !== undefined) entry(pkg[key]);
  if (typeof pkg.browser === "string") entry(pkg.browser);
  else if (pkg.browser !== undefined)
    issues.push("browser entry remapping needs a reviewed adapter");
  const exports = (value: unknown, depth = 0) => {
    if (depth > 8) throw Error("Package exports nesting exceeds bounds");
    if (value === null) return;
    if (typeof value === "string") {
      entry(value);
      return;
    }
    if (!value || Array.isArray(value) || typeof value !== "object")
      throw Error("Unsupported package exports");
    for (const [key, v] of Object.entries(value)) {
      if (key.startsWith(".")) {
        if (key !== ".") closedRepositoryPath(key.slice(2));
      }
      exports(v, depth + 1);
    }
  };
  if (pkg.exports !== undefined) exports(pkg.exports);
  if (
    pkg.scripts !== undefined &&
    (!pkg.scripts ||
      Array.isArray(pkg.scripts) ||
      typeof pkg.scripts !== "object")
  )
    throw Error("Invalid package scripts object");
  const scripts: Record<string, string> = {};
  for (const [key, value] of Object.entries(pkg.scripts ?? {})) {
    if (
      !/^[A-Za-z0-9:._-]+$/.test(key) ||
      typeof value !== "string" ||
      value.length > 4096
    )
      throw Error("Invalid package script metadata");
    scripts[key] = value;
  }
  const packages = [...files]
    .filter(([path]) => path.endsWith("/package.json"))
    .map(([path, body]) => ({ path, name: packageData(body).name ?? null }));
  if (
    pkg.workspaces !== undefined ||
    files.has("pnpm-workspace.yaml") ||
    files.has("lerna.json")
  )
    issues.push(
      "workspace orchestration is unsupported without a qualified native adapter",
    );
  if (!profile) issues.push("no exact reviewed native execution profile");
  if (profile) {
    if (
      profile.repository !== pin.repository ||
      profile.commit !== pin.commit ||
      profile.packageSha256 !== onboardingSha(pkgBytes) ||
      !isDeepStrictEqual(profile.scripts, scripts)
    )
      throw Error("Reviewed package/profile binding changed");
    const generated = new Set(profile.generatedPaths.map(closedRepositoryPath)),
      editable = new Set(profile.editablePaths.map(closedRepositoryPath));
    if (
      !editable.size ||
      editable.size !== profile.editablePaths.length ||
      generated.size !== profile.generatedPaths.length
    )
      throw Error("Profile source/output closure invalid");
    const protectedPath = (p: string) =>
      /(^|\/)(tests?|__tests__)(\/|$)|\.(?:test|spec)\.[cm]?[jt]sx?$|(^|\/)(package(?:-lock)?\.json|.*lock.*|.*config.*)$/i.test(
        p,
      );
    for (const path of editable)
      if (
        !files.has(path) ||
        protectedPath(path) ||
        !/\.(?:[cm]?js|tsx?|d\.ts)$/.test(path)
      )
        throw Error("Editable path is not isolated source");
    for (const path of generated)
      if (
        files.has(path) ||
        [...files.keys()].some(
          (p) => p.startsWith(path + "/") || path.startsWith(p + "/"),
        ) ||
        editable.has(path) ||
        protectedPath(path)
      )
        throw Error("Generated output overlaps original inputs");
    for (const path of entries)
      if (!files.has(path) && !generated.has(path))
        throw Error("Package entry outside reviewed source/build closure");
    for (const runtime of [
      profile.runtime.native,
      profile.runtime.observations,
    ])
      if (!/^v\d+\.\d+\.\d+$/.test(runtime))
        throw Error("Exact reviewed runtime required");
  }
  const inventory = [...files]
    .map(([path, body]) => ({
      path,
      bytes: body.length,
      sha256: onboardingSha(body),
    }))
    .sort((a, b) => a.path.localeCompare(b.path));
  const tests = inventory.filter((f) =>
    /(^|\/)(test|tests|__tests__)(\/|$)|\.(?:test|spec)\.[cm]?[jt]sx?$/.test(
      f.path,
    ),
  );
  if (!tests.length) issues.push("no original native test files discovered");
  const locks = inventory.filter((f) =>
    /(^|\/)(package-lock\.json|npm-shrinkwrap\.json|yarn\.lock|pnpm-lock\.yaml)$/.test(
      f.path,
    ),
  );
  return {
    format: "repolab-repository-onboarding-inspection/v1",
    repository: pin.repository,
    commit: pin.commit,
    archiveSha256: pin.archiveSha256,
    status: issues.length
      ? "UNSUPPORTED_REPOSITORY_PROFILE"
      : "PROFILE_ADMITTED_NOT_QUALIFIED",
    supported: issues.length === 0,
    qualified: false,
    repairAdmission: false,
    reasons: issues,
    package: {
      name: pkg.name ?? null,
      version: pkg.version ?? null,
      type: pkg.type ?? "unspecified",
      engines: pkg.engines ?? {},
      packageManager: pkg.packageManager ?? null,
      scripts,
      lifecycleScripts: Object.keys(scripts).filter((s) =>
        /^(preinstall|install|postinstall|prepare|prebuild|postbuild)$/.test(s),
      ),
      entries: [...entries].sort(),
      subpackages: packages,
    },
    originalFileCount: inventory.length,
    originalInventorySha256: onboardingSha(JSON.stringify(inventory)),
    nativeTestFiles: tests.length,
    nativeTestInventorySha256: onboardingSha(JSON.stringify(tests)),
    lockfiles: locks,
    dependencyPreparation: locks.length
      ? "pinned original lock; ignore lifecycle scripts during install"
      : "no original lock; require receipt-bound resolved lock before execution",
    reviewedRuntime: profile?.runtime ?? null,
    editablePaths: profile?.editablePaths ?? [],
    generatedPaths: profile?.generatedPaths ?? [],
    declaredEngineIsExecutionQualification: false,
    inference: "none",
    execution: "data-only archive inspection; no source execution",
  };
}
