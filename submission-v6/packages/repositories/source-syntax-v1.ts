import { crossSha } from "../execution/cross-repo-sandbox-v1.ts";

/** Require a real, complete --check result for every pinned source path. */
export function assertSourceSyntax(guest: any, config: any) {
  const syntax = guest?.syntax;
  if (
    syntax?.format !== "repolab-source-syntax/v1" ||
    !Array.isArray(syntax.rows) ||
    syntax.rows.length !== config.sourcePaths.length ||
    !syntax.rows.length
  )
    throw Error("Missing or incomplete Sandbox syntax inventory");
  const seen = new Set<string>();
  for (const row of syntax.rows) {
    const expectedHash =
      config.overrides[row.path] ?? config.files[row.path]?.sha256;
    if (
      !config.sourcePaths.includes(row.path) ||
      seen.has(row.path) ||
      row.sha256 !== expectedHash ||
      guest.sourceFiles?.[row.path] !== expectedHash ||
      row.command !== "/usr/local/bin/node" ||
      JSON.stringify(row.args) !==
        JSON.stringify(["--check", "/opt/repolab/cross/work/" + row.path]) ||
      row.uid !== 1000 ||
      !row.check ||
      row.check.exitCode !== 0 ||
      row.check.signal !== null ||
      row.check.error !== null ||
      row.check.stdout !== "" ||
      row.check.stderr !== ""
    )
      throw Error("Sandbox source syntax rejected: " + String(row.path));
    seen.add(row.path);
  }
}

export function syntaxControlSources(m: any, valid: boolean) {
  if (JSON.stringify(m.sourcePaths) !== '["index.js"]')
    throw Error("Closed syntax control fixture");
  return {
    ...m.sources,
    "index.js":
      m.sources["index.js"] +
      (valid
        ? '\nthrow new Error("syntax-check-must-not-execute");\n'
        : '\nconst broken = true ? "incomplete";\n'),
  } as Record<string, string>;
}
