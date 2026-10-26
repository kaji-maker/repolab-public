import { spawn } from "node:child_process";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { Execution, Executor } from "../contracts/index.ts";
import { sha256 } from "../evidence/hash.ts";
import { reviewedSources } from "../profiles/index.ts";
import { validateCompiledTests } from "../controller/tests.ts";

const reviewed = new Map(
  reviewedSources.map(({ source, path }) => [sha256(source), path]),
);

export class TrustedFixtureExecutor implements Executor {
  provider = "trusted-fixture" as const;

  async execute(
    source: string,
    tests: string,
    signal?: AbortSignal,
  ): Promise<Execution> {
    if (!reviewed.has(sha256(source)))
      throw new Error(
        "Local execution accepts reviewed fixture source only. Model-generated source requires Nebius Sandboxes.",
      );
    const sourcePath = validateCompiledTests(tests);
    if (reviewed.get(sha256(source)) !== sourcePath)
      throw new Error("Reviewed source does not match the test profile");
    if (signal?.aborted) throw signal.reason;
    const directory = await mkdtemp(join(tmpdir(), "repolab-fixture-"));
    const start = performance.now();
    try {
      await mkdir(join(directory, "src"));
      await writeFile(join(directory, sourcePath), source);
      await writeFile(join(directory, "test.mjs"), tests);
      return await new Promise<Execution>((resolve, reject) => {
        const child = spawn(
          process.execPath,
          [
            "--permission",
            `--allow-fs-read=${directory}`,
            join(directory, "test.mjs"),
          ],
          {
            cwd: directory,
            env: { PATH: process.env.PATH, TZ: "UTC", LANG: "C.UTF-8" },
            stdio: ["ignore", "pipe", "pipe"],
          },
        );
        let stdout = "",
          stderr = "",
          truncated = false,
          timedOut = false;
        const collect = (current: string, bytes: Buffer) => {
          const next = current + bytes.toString("utf8");
          if (Buffer.byteLength(next) > 16_384) {
            truncated = true;
            child.kill("SIGKILL");
            return next.slice(0, 16_384);
          }
          return next;
        };
        child.stdout.on("data", (chunk: Buffer) => {
          stdout = collect(stdout, chunk);
        });
        child.stderr.on("data", (chunk: Buffer) => {
          stderr = collect(stderr, chunk);
        });
        const timer = setTimeout(() => {
          timedOut = true;
          child.kill("SIGKILL");
        }, 5000);
        const abort = () => child.kill("SIGKILL");
        signal?.addEventListener("abort", abort, { once: true });
        child.on("error", (error) => {
          clearTimeout(timer);
          signal?.removeEventListener("abort", abort);
          reject(error);
        });
        child.on("close", (exitCode, exitSignal) => {
          clearTimeout(timer);
          signal?.removeEventListener("abort", abort);
          if (signal?.aborted) {
            reject(signal.reason);
            return;
          }
          resolve({
            id: randomUUID(),
            provider: this.provider,
            runtimeVersion: process.version,
            sourceHash: sha256(source),
            testHash: sha256(tests),
            exitCode,
            signal: exitSignal,
            timedOut,
            truncated,
            durationMs: Math.round(performance.now() - start),
            stdout,
            stderr,
          });
        });
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }
}
