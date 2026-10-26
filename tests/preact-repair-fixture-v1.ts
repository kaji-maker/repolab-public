import {
  readFileSync,
  writeFileSync,
  mkdtempSync,
  rmSync,
  existsSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { shaNative } from "../packages/evaluation/preact-native-v5.ts";
import {
  admissionRequest,
  parseAdmissionReceipt,
} from "../packages/execution/preact-admission-v5.ts";
import type { NativeRemote } from "../packages/execution/preact-replay-v1.ts";
const selected = JSON.parse(
  readFileSync("evaluation/preact-trial-v10-results-summary.json", "utf8"),
).result;
const inventories = JSON.parse(
  readFileSync("fixtures/preact-native/baseline-identities-v1.json", "utf8"),
);
const publicRows = selected.public.rows;
export function fakeFreshRemote(
  dir: string,
  mutate?: (raw: any) => void,
  after?: () => void,
): NativeRemote {
  return {
    upload: async (path, bytes, name) => {
      const uuid = randomUUID(),
        handle = { uuid, uid: 0, gid: 0, mode: "0444" };
      writeFileSync(
        join(dir, "upload-" + name + ".json"),
        JSON.stringify({
          path,
          status: "VERIFIED",
          startedAt: new Date().toISOString(),
          sha256: shaNative(bytes),
          bytes: bytes.length,
          response: { uuid, sha256: shaNative(bytes), size: bytes.length },
        }),
        { mode: 0o600 },
      );
      return handle;
    },
    run: async (variant, stage, image, sourceHash, files) => {
      const base = stage.replace(/-[AB]$/, ""),
        request = admissionRequest(stage, image, files),
        g: any = {
          stage: base,
          sourceHash,
          runtimeVersion: "v20.9.0",
          uid: request.uid,
          gid: request.gid,
          envKeys: Object.keys(request.env),
          completed: true,
          expectedInputsIntact: true,
          commands: [],
        };
      const commands: Record<string, [string, string[]]> = {
        build: ["/usr/local/bin/npm", ["run", "build"]],
        lint: ["/usr/local/bin/npm", ["run", "lint"]],
        mocha: [
          "/usr/local/bin/node",
          [
            "/opt/repolab/preact/node_modules/mocha/bin/mocha",
            "--recursive",
            "--require",
            "@babel/register",
            "--reporter",
            "json",
            "test/shared",
            "test/node",
          ],
        ],
        types: ["/usr/local/bin/npm", ["run", "test:ts"]],
        browser: ["/usr/local/bin/node", ["/opt/repolab/native/karma.cjs"]],
        public: [
          "/usr/bin/chromium",
          [
            "--headless",
            "--no-sandbox",
            "--disable-gpu",
            "--disable-dev-shm-usage",
            "--no-first-run",
            "--dump-dom",
            "file:///opt/repolab/native/public.html",
          ],
        ],
        independent: [
          "/usr/bin/chromium",
          [
            "--headless",
            "--no-sandbox",
            "--disable-gpu",
            "--disable-dev-shm-usage",
            "--no-first-run",
            "--dump-dom",
            "file:///opt/repolab/native/independent.html",
          ],
        ],
      };
      if (commands[base])
        g.commands = [
          {
            executable: commands[base][0],
            args: commands[base][1],
            exitCode: 0,
            signal: null,
            errorCode: null,
            stdout:
              base === "types"
                ? "tsc -p test/ts/\ntsc -p compat/test/ts/\n 17 passing (1ms)\n 2 pending\n"
                : "",
            stderr: "",
          },
        ];
      if (base === "mocha") {
        const names = inventories.mocha.cases.map((c: any) => ({
          fullTitle: c.id,
        }));
        g.mocha = {
          stats: {
            tests: names.length,
            passes: names.length,
            pending: 0,
            failures: 0,
          },
          tests: names,
          passes: names,
          pending: [],
          failures: [],
        };
      }
      if (base === "browser") {
        const cases = inventories.browser.cases
          .map((c: any) => {
            const m = c.id.match(/^(\d+):(.*)$/),
              parts = m[2].split(" > ");
            return {
              ordinal: Number(m[1]),
              suite: parts.slice(0, -1),
              description: parts.at(-1),
              success: !c.skipped,
              skipped: c.skipped,
              log: [],
            };
          })
          .sort((a: any, b: any) => a.ordinal - b.ordinal);
        g.browser = {
          result: { success: 1173, failed: 0, skipped: 11 },
          cases,
        };
      }
      if (base === "integrity") {
        g.denials = [
          ...[
            "package-lock.json",
            "src/diff/index.js",
            "test/browser/refs.test.js",
          ].flatMap((path) =>
            ["write", "unlink", "replace"].map((action) => ({
              path,
              action,
              error: "EACCES",
            })),
          ),
          { action: "rename-tests", error: "EACCES" },
          { action: "symlink-test", error: "EACCES" },
        ];
        g.network = "ENETUNREACH";
      }
      if (base === "public") {
        g.observations = structuredClone(publicRows);
        if (variant === "original")
          g.observations[0].events = ["mount", "null"];
      }
      if (base === "independent") g.observations = selected.independent.rows;
      const id = randomUUID(),
        raw: any = {
          variant,
          stage,
          sourceHash,
          inference:
            variant === "original" ? "none (reviewed original)" : "nebius",
          execution: "simulation; source was not executed",
          startedAt: new Date().toISOString(),
          completedAt: new Date().toISOString(),
          request,
          id,
          status: "SUCCESS",
          latest: {
            uuid: id,
            image_uuid: image,
            status: "SUCCESS",
            result_image_uuid: base === "build" ? randomUUID() : undefined,
            metadata: {
              result: {
                state: { exit_code: 0, signal: 0, timed_out: false },
                stdout: {
                  value: JSON.stringify(g),
                  encoding: "utf8",
                  truncated: false,
                },
                stderr: { value: "", encoding: "ascii", truncated: false },
              },
            },
          },
        };
      mutate?.(raw);
      writeFileSync(
        join(dir, variant + "-" + stage + ".json"),
        JSON.stringify(raw),
        { mode: 0o600 },
      );
      after?.();
      return parseAdmissionReceipt(raw.latest, stage, id, image, sourceHash);
    },
  };
}
