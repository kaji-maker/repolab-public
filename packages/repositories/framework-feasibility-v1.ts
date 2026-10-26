import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import ts from "typescript";
import { closedRepositoryPath, onboardingSha } from "./onboarding-v1.ts";
import { assertNativeNoSecrets } from "./preact-pack-v1.ts";

export type PinnedSourceInventoryRow = {
  instance_id: string;
  repo: string;
  base_commit: string;
  gitTreeResponseSha256: string;
  rootPackageSha256: string;
  fileCount: number;
  typescriptFiles: number;
  javascriptFiles: number;
  lockAndWorkspaceFiles: string[];
  declaredScriptNames: string[];
  runtimeEngines: Record<string, string>;
  packageManager: string | null;
  upstreamSourceExecuted: boolean;
  baseCommitVerified: boolean;
  gitTreeSha1: string;
  rootPackageGitBlobSha1: string;
  commitResponseSha256: string;
  canonicalTreeResponseSha256: string;
};

export type TargetSubpackageSpec = {
  directory: string;
  manifestPath: string;
  manifestGitBlobSha1: string;
  candidateEditablePaths: string[];
  candidateNativeTestPaths: string[];
  nativeSuiteCommand: string;
};

export type PinnedGitTreeInput = {
  commitBytes: Buffer;
  canonicalTreeBytes: Buffer;
  treeBytes: Buffer;
  packageBytes: Buffer;
  originalContextBytes: Buffer;
  expectedContextSha256: string;
  localArchiveAvailable?: boolean;
  subpackageBlobsAvailable?: boolean;
  sandboxQualificationReceiptsAvailable?: boolean;
};

const gitBlobSha1 = (bytes: Buffer | string) => {
  const b = typeof bytes === "string" ? Buffer.from(bytes, "utf8") : bytes;
  return createHash("sha1")
    .update(`blob ${b.length}\0`)
    .update(b)
    .digest("hex");
};

const KNOWN_VERSION_BLOBS: Record<string, string> = {
  [gitBlobSha1("20\n")]: "20",
  [gitBlobSha1("18\n")]: "18",
};

function safeJsonObject(bytes: Buffer, label: string, maxBytes = 2_000_000) {
  if (bytes.length > maxBytes) throw Error(`${label} exceeds bounds`);
  const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes),
    ast = ts.parseJsonText(label, text);
  if ((ast as any).parseDiagnostics.length)
    throw Error(`Invalid ${label} JSON`);
  const walk = (node: ts.Node) => {
    if (ts.isObjectLiteralExpression(node)) {
      const keys = new Set<string>();
      for (const p of node.properties) {
        if (!ts.isPropertyAssignment(p) || !ts.isStringLiteral(p.name))
          throw Error(`Invalid ${label} property`);
        const key = p.name.text;
        if (
          keys.has(key) ||
          ["__proto__", "prototype", "constructor"].includes(key)
        )
          throw Error(`Duplicate or unsafe ${label} property`);
        keys.add(key);
      }
    }
    ts.forEachChild(node, walk);
  };
  walk(ast);
  const value = JSON.parse(text);
  if (!value || Array.isArray(value) || typeof value !== "object")
    throw Error(`${label} must be an object`);
  return value;
}

function isSafePath(path: string) {
  try {
    closedRepositoryPath(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Inspects pinned Git commit/canonical-tree/recursive-tree/package metadata as data
 * against the frozen external source inventory and closed archive/workspace rules.
 */
export function inspectPinnedGitTreeFeasibility(
  pin: PinnedSourceInventoryRow,
  target: TargetSubpackageSpec,
  input: PinnedGitTreeInput,
  candidateRank: number,
) {
  if (
    !/^[a-f0-9]{40}$/.test(pin.base_commit) ||
    !/^[a-f0-9]{40}$/.test(pin.gitTreeSha1) ||
    !/^[a-f0-9]{40}$/.test(pin.rootPackageGitBlobSha1) ||
    !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(pin.repo) ||
    pin.upstreamSourceExecuted !== false ||
    pin.baseCommitVerified !== true
  )
    throw Error("Pinned source inventory row invalid");
  if (
    onboardingSha(input.commitBytes) !== pin.commitResponseSha256 ||
    onboardingSha(input.canonicalTreeBytes) !==
      pin.canonicalTreeResponseSha256 ||
    onboardingSha(input.treeBytes) !== pin.gitTreeResponseSha256 ||
    onboardingSha(input.packageBytes) !== pin.rootPackageSha256 ||
    onboardingSha(input.originalContextBytes) !== input.expectedContextSha256
  )
    throw Error("Pinned Git metadata digest changed");
  if (gitBlobSha1(input.packageBytes) !== pin.rootPackageGitBlobSha1)
    throw Error("Root package Git blob SHA-1 mismatch");

  const commit = safeJsonObject(input.commitBytes, "commit.json"),
    canonicalTree = safeJsonObject(
      input.canonicalTreeBytes,
      "canonical-tree.json",
    ),
    tree = safeJsonObject(input.treeBytes, "tree.json"),
    pkg = safeJsonObject(input.packageBytes, "package.json", 1_000_000),
    context = safeJsonObject(
      input.originalContextBytes,
      "original-context.json",
      200_000,
    );

  if (
    Object.keys(context).some(
      (k) => !["taskId", "repository", "baseCommit", "bugReport"].includes(k),
    ) ||
    context.taskId !== pin.instance_id ||
    context.repository !== pin.repo ||
    context.baseCommit !== pin.base_commit ||
    typeof context.bugReport !== "string" ||
    !context.bugReport.length
  )
    throw Error("Original task context identity changed");

  if (
    commit.sha !== pin.base_commit ||
    commit.tree?.sha !== pin.gitTreeSha1 ||
    canonicalTree.sha !== pin.gitTreeSha1 ||
    tree.sha !== pin.base_commit ||
    canonicalTree.truncated === true ||
    tree.truncated !== false ||
    !Array.isArray(canonicalTree.tree) ||
    !Array.isArray(tree.tree) ||
    !isDeepStrictEqual(canonicalTree.tree, tree.tree)
  )
    throw Error("Pinned commit or canonical Git tree binding changed");

  const entries: {
    path: string;
    mode: string;
    type: string;
    sha: string;
    size?: number;
  }[] = tree.tree;

  const blobs = entries.filter((e) => e.type === "blob"),
    trees = entries.filter((e) => e.type === "tree");
  if (blobs.length !== pin.fileCount)
    throw Error("Pinned tree blob count mismatch");

  const rootPkgBlob = blobs.find((e) => e.path === "package.json");
  if (
    !rootPkgBlob ||
    rootPkgBlob.sha !== pin.rootPackageGitBlobSha1 ||
    rootPkgBlob.size !== input.packageBytes.length
  )
    throw Error("Root package tree entry mismatch");

  const modes = [...new Set(entries.map((e) => String(e.mode)))].sort(),
    unsupportedModes = modes.filter((m) => !["040000", "100644"].includes(m)),
    symlinkPaths = entries
      .filter((e) => e.mode === "120000")
      .map((e) => e.path),
    executablePaths = entries
      .filter((e) => e.mode === "100755")
      .map((e) => e.path),
    submodulePaths = entries
      .filter((e) => e.mode === "160000")
      .map((e) => e.path);

  let totalBlobBytes = 0,
    maxBlob = { path: "", bytes: 0 };
  for (const b of blobs) {
    if (
      typeof b.path !== "string" ||
      !/^[a-f0-9]{40}$/.test(b.sha) ||
      typeof b.size !== "number" ||
      !Number.isSafeInteger(b.size) ||
      b.size < 0
    )
      throw Error("Invalid Git blob entry");
    totalBlobBytes += b.size;
    if (b.size > maxBlob.bytes) maxBlob = { path: b.path, bytes: b.size };
  }

  const unsafeTreePaths = entries
      .filter((e) => !isSafePath(e.path))
      .map((e) => e.path),
    unsafeBlobPaths = blobs
      .filter((e) => !isSafePath(e.path))
      .map((e) => e.path);

  const lowerSeen = new Set<string>(),
    caseCollisions: string[] = [];
  for (const e of entries) {
    const low = e.path.toLowerCase();
    if (lowerSeen.has(low)) caseCollisions.push(e.path);
    lowerSeen.add(low);
  }
  const blobPathSet = new Set(blobs.map((b) => b.path)),
    directoryShadows: string[] = [];
  for (const p of blobPathSet) {
    const parts = p.split("/");
    for (let i = 1; i < parts.length; i++) {
      if (blobPathSet.has(parts.slice(0, i).join("/")))
        directoryShadows.push(p);
    }
  }

  const withinDecompressedArchiveLimit = totalBlobBytes <= 32_000_000,
    withinSingleFileLimit = maxBlob.bytes <= 4_000_000,
    withinFileCountLimit = blobs.length >= 1 && blobs.length <= 10_000,
    treeArchiveCompatible =
      withinDecompressedArchiveLimit &&
      withinSingleFileLimit &&
      withinFileCountLimit &&
      unsupportedModes.length === 0 &&
      unsafeTreePaths.length === 0 &&
      caseCollisions.length === 0 &&
      directoryShadows.length === 0;

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
  if (
    !isDeepStrictEqual(Object.keys(scripts).sort(), pin.declaredScriptNames) ||
    !isDeepStrictEqual(pkg.engines ?? {}, pin.runtimeEngines) ||
    (pkg.packageManager ?? null) !== pin.packageManager
  )
    throw Error("Root package metadata disagrees with frozen source inventory");

  const rootEntries: string[] = [];
  for (const key of ["main", "module", "types", "typings", "unpkg", "browser"])
    if (typeof pkg[key] === "string")
      rootEntries.push(closedRepositoryPath(pkg[key].replace(/^\.\//, "")));
  if (pkg.exports !== undefined) {
    const collect = (v: unknown, depth = 0) => {
      if (depth > 8) throw Error("Package exports nesting exceeds bounds");
      if (typeof v === "string")
        rootEntries.push(closedRepositoryPath(v.replace(/^\.\//, "")));
      else if (v && typeof v === "object" && !Array.isArray(v))
        for (const child of Object.values(v)) collect(child, depth + 1);
    };
    collect(pkg.exports);
  }

  const catalogDependencies: string[] = [],
    workspaceProtocolDependencies: string[] = [];
  for (const field of [
    "dependencies",
    "devDependencies",
    "peerDependencies",
    "optionalDependencies",
  ]) {
    const group = pkg[field];
    if (group && typeof group === "object" && !Array.isArray(group)) {
      for (const [dep, spec] of Object.entries(group)) {
        if (typeof spec !== "string")
          throw Error("Invalid dependency specifier");
        if (spec.startsWith("catalog:"))
          catalogDependencies.push(`${dep}@${spec}`);
        if (spec.startsWith("workspace:"))
          workspaceProtocolDependencies.push(`${dep}@${spec}`);
      }
    }
  }

  const subpackageManifests = blobs
    .filter((b) => b.path !== "package.json" && b.path.endsWith("/package.json"))
    .map((b) => ({ path: b.path, bytes: b.size!, gitBlobSha1: b.sha }))
    .sort((a, b) => a.path.localeCompare(b.path));

  const lockfiles = blobs
    .filter((b) =>
      /(^|\/)(package-lock\.json|npm-shrinkwrap\.json|yarn\.lock|pnpm-lock\.yaml)$/.test(
        b.path,
      ),
    )
    .map((b) => ({ path: b.path, bytes: b.size!, gitBlobSha1: b.sha }))
    .sort((a, b) => a.path.localeCompare(b.path));

  const workspaceConfigFiles = blobs
    .filter((b) => /(^|\/)(pnpm-workspace\.yaml|lerna\.json)$/.test(b.path))
    .map((b) => ({ path: b.path, bytes: b.size!, gitBlobSha1: b.sha }))
    .sort((a, b) => a.path.localeCompare(b.path));

  const versionHintFiles = blobs
    .filter((b) => /(^|\/)(\.node-version|\.nvmrc)$/.test(b.path))
    .map((b) => ({
      path: b.path,
      bytes: b.size!,
      gitBlobSha1: b.sha,
      decodedMajorHint: KNOWN_VERSION_BLOBS[b.sha] ?? null,
    }));

  const nativeTests = blobs
    .filter((b) =>
      /(^|\/)(test|tests|__tests__)(\/|$)|\.(?:test|spec)\.[cm]?[jt]sx?$/.test(
        b.path,
      ),
    )
    .map((b) => ({ path: b.path, bytes: b.size!, gitBlobSha1: b.sha }))
    .sort((a, b) => a.path.localeCompare(b.path));

  closedRepositoryPath(target.directory);
  closedRepositoryPath(target.manifestPath);
  const subpkgBlobs = blobs.filter((b) =>
      b.path.startsWith(target.directory + "/"),
    ),
    subpkgManifest = blobs.find((b) => b.path === target.manifestPath);
  if (!subpkgManifest || subpkgManifest.sha !== target.manifestGitBlobSha1)
    throw Error("Target subpackage manifest blob identity mismatch");

  const protectedPath = (p: string) =>
    /(^|\/)(tests?|__tests__)(\/|$)|\.(?:test|spec)\.[cm]?[jt]sx?$|(^|\/)(package(?:-lock)?\.json|.*lock.*|.*config.*)$/i.test(
      p,
    );
  const candidateEditable = target.candidateEditablePaths.map((p) => {
    closedRepositoryPath(p);
    const b = blobs.find((x) => x.path === p);
    if (
      !b ||
      !p.startsWith(target.directory + "/src/") ||
      protectedPath(p) ||
      !/\.(?:[cm]?js|tsx?|d\.ts)$/.test(p)
    )
      throw Error("Candidate editable path is not isolated subpackage source");
    return { path: b.path, bytes: b.size!, gitBlobSha1: b.sha };
  });
  const candidateNativeTests = target.candidateNativeTestPaths.map((p) => {
    closedRepositoryPath(p);
    const b = blobs.find((x) => x.path === p);
    if (!b || !p.startsWith(target.directory + "/") || !protectedPath(p))
      throw Error("Candidate native test path is not in target subpackage");
    return { path: b.path, bytes: b.size!, gitBlobSha1: b.sha };
  });

  const subpkgSourceFiles = subpkgBlobs.filter(
      (b) =>
        b.path.startsWith(target.directory + "/src/") &&
        !protectedPath(b.path) &&
        /\.(?:[cm]?js|tsx?|d\.ts)$/.test(b.path),
    ),
    subpkgTestFiles = subpkgBlobs.filter((b) => protectedPath(b.path)),
    subpkgUnsafePaths = subpkgBlobs
      .filter((b) => !isSafePath(b.path))
      .map((b) => b.path);

  const blockers: { code: string; detail: string }[] = [];
  if (!treeArchiveCompatible) {
    if (!withinDecompressedArchiveLimit)
      blockers.push({
        code: "ARCHIVE_DECOMPRESSED_SIZE_EXCEEDS_32MB_CAP",
        detail: `Total uncompressed blob size is ${totalBlobBytes} bytes (> 32,000,000 byte readPinnedRepositoryArchive cap)`,
      });
    if (unsupportedModes.length)
      blockers.push({
        code: "UNSUPPORTED_GIT_TREE_MODES",
        detail: `Tree contains unsupported modes ${unsupportedModes.join(", ")} (${symlinkPaths.length} symlinks, ${executablePaths.length} executables)`,
      });
    if (unsafeTreePaths.length)
      blockers.push({
        code: "UNSAFE_REPOSITORY_PATHS",
        detail: `${unsafeTreePaths.length} tree entries (${unsafeBlobPaths.length} blobs) fail closedRepositoryPath character/segment constraints`,
      });
  }
  if (!input.localArchiveAvailable || !input.subpackageBlobsAvailable)
    blockers.push({
      code: "MISSING_PINNED_SOURCE_ARCHIVE_AND_SUBPACKAGE_BLOBS",
      detail: `Pinned source archive (${pin.repo}@${pin.base_commit}) and ${subpackageManifests.length} subpackage manifests (including ${target.manifestPath}) are not staged locally in repositories/ or fixtures/`,
    });
  if (
    workspaceConfigFiles.length ||
    Array.isArray(pkg.workspaces) ||
    catalogDependencies.length ||
    !rootEntries.length
  )
    blockers.push({
      code: "UNQUALIFIED_WORKSPACE_AND_PACKAGE_MANAGER_ADAPTER",
      detail:
        pin.repo === "vuejs/core"
          ? `Private root package with 0 root entry fields requires ${pin.packageManager} workspace orchestration (pnpm-workspace.yaml + pnpm-lock.yaml), ${catalogDependencies.length} catalog: dependency specifiers, and ${subpackageManifests.length} subpackages`
          : `Private root package with 0 root entry fields requires Yarn + Lerna workspace orchestration (lerna.json + ${lockfiles.length} yarn.lock files) across ${subpackageManifests.length} subpackages`,
    });
  blockers.push({
    code: "UNQUALIFIED_EXACT_RUNTIME_PROFILE",
    detail: `Declared engines ${JSON.stringify(pkg.engines ?? {})} and version hint files (${versionHintFiles.map((v) => `${v.path}=${v.decodedMajorHint ?? "unknown"}`).join(", ") || "none"}) are untrusted range/major hints without an exact reviewed runtime receipt`,
  });
  if (!input.sandboxQualificationReceiptsAvailable)
    blockers.push({
      code: "MISSING_ORIGINAL_SANDBOX_SUITE_AND_REPRODUCTION_RECEIPTS",
      detail: `Unchanged native suite (${target.nativeSuiteCommand}) and repeated original bug reproduction in Nebius Sandbox are required before inference; 0 original-only Sandbox receipts exist for ${pin.instance_id}`,
    });

  const result = {
    format: "repolab-framework-native-feasibility/v1",
    taskId: pin.instance_id,
    repository: pin.repo,
    commit: pin.base_commit,
    candidateRank,
    status: "UNSUPPORTED_REPOSITORY_PROFILE" as const,
    feasibilityVerdict: treeArchiveCompatible
      ? ("PRIMARY_CANDIDATE_BLOCKED_ON_WORKSPACE_ARCHIVE_AND_SANDBOX_BASELINE" as const)
      : ("SECONDARY_CANDIDATE_BLOCKED_ON_ARCHIVE_BOUNDS_MODES_PATHS_AND_WORKSPACE" as const),
    supported: false,
    qualified: false,
    repairAdmission: false,
    inferenceReady: false,
    treeFeasibility: {
      gitTreeSha1: pin.gitTreeSha1,
      canonicalTreeVerified: true,
      truncated: false,
      blobCount: blobs.length,
      directoryCount: trees.length,
      totalBlobBytes,
      maxDecompressedArchiveBytesCap: 32_000_000,
      withinDecompressedArchiveLimit,
      maxBlob,
      maxSingleFileBytesCap: 4_000_000,
      withinSingleFileLimit,
      modes,
      unsupportedModes,
      symlinkCount: symlinkPaths.length,
      executableCount: executablePaths.length,
      submoduleCount: submodulePaths.length,
      unsafeTreePathCount: unsafeTreePaths.length,
      unsafeBlobPathCount: unsafeBlobPaths.length,
      caseCollisionCount: caseCollisions.length,
      directoryShadowCount: directoryShadows.length,
      treeArchiveCompatible,
      treeBlobInventorySha256: onboardingSha(
        JSON.stringify(
          blobs.map((b) => ({ path: b.path, bytes: b.size, sha1: b.sha })),
        ),
      ),
    },
    packageFeasibility: {
      rootPackageSha256: pin.rootPackageSha256,
      rootPackageGitBlobSha1: pin.rootPackageGitBlobSha1,
      name: pkg.name ?? null,
      version: pkg.version ?? null,
      private: Boolean(pkg.private),
      type: pkg.type ?? "unspecified",
      packageManager: pkg.packageManager ?? null,
      engines: pkg.engines ?? {},
      versionHintFiles,
      declaredEngineIsExecutionQualification: false,
      workspaces: pkg.workspaces ?? null,
      workspaceConfigFiles,
      lockfiles,
      catalogDependencies: catalogDependencies.sort(),
      workspaceProtocolDependencies: workspaceProtocolDependencies.sort(),
      rootEntries: [...new Set(rootEntries)].sort(),
      subpackageCount: subpackageManifests.length,
      lifecycleScripts: Object.keys(scripts)
        .filter((s) =>
          /^(preinstall|install|postinstall|prepare|prebuild|postbuild)$/.test(
            s,
          ),
        )
        .sort(),
      nativeTestFileCount: nativeTests.length,
      nativeTestTreeDigest: onboardingSha(JSON.stringify(nativeTests)),
    },
    targetSubpackage: {
      directory: target.directory,
      manifestPath: target.manifestPath,
      manifestGitBlobSha1: target.manifestGitBlobSha1,
      manifestBytes: subpkgManifest.size!,
      totalBlobCount: subpkgBlobs.length,
      isolatedSourceFileCount: subpkgSourceFiles.length,
      protectedTestAndConfigFileCount: subpkgTestFiles.length,
      unsafePathCount: subpkgUnsafePaths.length,
      subpackagePathsClean: subpkgUnsafePaths.length === 0,
      candidateEditableFiles: candidateEditable,
      candidateNativeTestFiles: candidateNativeTests,
      nativeSuiteCommand: target.nativeSuiteCommand,
    },
    prerequisites: {
      localPinnedArchiveAvailable: Boolean(input.localArchiveAvailable),
      subpackageBlobsAvailable: Boolean(input.subpackageBlobsAvailable),
      reviewedExecutionProfileAvailable: false,
      originalSandboxSuiteAndReproductionAvailable: Boolean(
        input.sandboxQualificationReceiptsAvailable,
      ),
    },
    blockers,
    reasons: blockers.map((b) => `${b.code}: ${b.detail}`),
    inference: "none",
    execution:
      "data-only pinned Git tree/package feasibility inspection; no source execution",
  };
  assertNativeNoSecrets(result);
  return result;
}
