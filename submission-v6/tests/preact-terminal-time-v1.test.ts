import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FreshPreactSandbox as Parent } from "../packages/execution/preact-repair-v3.ts";
import { FreshPreactSandbox, terminalCompletionRecord } from "../packages/execution/preact-terminal-time-v1.ts";
import { GuardedFreshPreactSandbox } from "../packages/execution/guarded-preact-sandbox-v2.ts";
import { trialInput } from "../packages/execution/preact-trial-v10.ts";
import { exportNativePreactPack } from "../packages/repositories/preact-pack-v1.ts";
import { createFreshPreactSession, runFreshPreact } from "../packages/repositories/preact-repair-v4.ts";
import { auditFreshPreact, freshAssets, freshBytes } from "../packages/repositories/preact-repair-protocol-v4.ts";
import { shaNative } from "../packages/evaluation/preact-native-v5.ts";
import { fakeFreshRemote } from "./preact-repair-fixture-v1.ts";

const cfg = {
  token: "synthetic-terminal-token", project: "synthetic-terminal-project",
  coverageConfirmed: true, baseUrl: "https://api.tokenfactory.nebius.com/sandboxes/",
  image: "synthetic", timeoutSeconds: 60,
} as any;

async function metadata(variant = "original", stage = "public-A", image: string = randomUUID(), proposal: unknown = null, files = {}) {
  const dir = mkdtempSync(join(tmpdir(), "repolab-terminal-metadata-"));
  const sourceHash = trialInput(proposal).sourceHash;
  try {
    await fakeFreshRemote(dir).run(variant, stage, image, sourceHash, files);
    const raw = JSON.parse(readFileSync(join(dir, variant + "-" + stage + ".json"), "utf8"));
    delete raw.completedAt;
    return { raw, expected: { variant, stage, image, sourceHash, request: raw.request } };
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

function transport(raw: any) {
  const methods: string[] = [];
  const fetcher: typeof fetch = async (_url, init) => {
    const method = init?.method ?? "GET";
    methods.push(method);
    if (method === "POST") return Response.json({ uuid: raw.id });
    if (method === "DELETE") return new Response(null, { status: 204 });
    return Response.json(raw.latest);
  };
  return { fetcher, methods };
}

test("terminal observation adds lifecycle time without changing the rejected receipt or claiming success", async () => {
  const { raw, expected } = await metadata();
  const before = structuredClone(raw), now = new Date().toISOString();
  for (const status of ["SUCCESS", "FAILED", "CANCELLED"]) {
    const value = structuredClone(raw);
    value.status = value.latest.status = status;
    const recorded = terminalCompletionRecord(value, expected, now)!;
    assert.equal(recorded.completedAt, now);
    delete recorded.completedAt;
    assert.deepEqual(recorded, value);
    assert.equal(recorded.verified, undefined);
  }
  assert.deepEqual(raw, before);
});

test("identity, request, source, uncertainty and invalid clock counterexamples gain no completion time", async () => {
  const { raw, expected } = await metadata();
  const now = new Date().toISOString();
  const mutations: ((v: any) => void)[] = [
    v => { v.variant = "candidate-1"; }, v => { v.stage = "public-B"; },
    v => { v.sourceHash = "0".repeat(64); }, v => { v.request.uid++; },
    v => { v.id = randomUUID(); }, v => { delete v.id; },
    v => { v.latest.uuid = randomUUID(); }, v => { v.latest.image_uuid = randomUUID(); },
    v => { v.status = "FAILED"; }, v => { v.status = v.latest.status = "EXECUTING"; },
    v => { v.status = v.latest.status = "MYSTERY"; }, v => { delete v.latest; },
    v => { v.submissionUnconfirmed = true; }, v => { v.cancellation = "unconfirmed"; },
    v => { v.completedAt = null; }, v => { v.completedAt = "malformed"; },
    v => { v.completedAt = now; }, v => { v.startedAt = "bad"; },
    v => { v.startedAt = "2026-01-01"; }, v => { v.startedAt = "9999-01-01T00:00:00.000Z"; },
  ];
  for (const [i, mutate] of mutations.entries()) {
    const value = structuredClone(raw); mutate(value);
    const before = structuredClone(value);
    assert.equal(terminalCompletionRecord(value, expected, now), null, `counterexample ${i}`);
    assert.deepEqual(value, before);
  }
  for (const clock of ["bad", "2026-01-01", "2000-01-01T00:00:00.000Z"])
    assert.equal(terminalCompletionRecord(raw, expected, clock), null);
});

test("V3 reproduces missing time; V4 persists it while rethrowing the same terminal guest rejection", async () => {
  const { raw, expected } = await metadata();
  raw.latest.metadata.result.stdout.value = "invalid synthetic guest result";
  const errors: string[] = [];
  for (const Client of [Parent, FreshPreactSandbox]) {
    const dir = mkdtempSync(join(tmpdir(), "repolab-terminal-client-")), wire = transport(raw);
    try {
      const client = new Client(dir, "original", null, cfg, new AbortController().signal, wire.fetcher);
      await assert.rejects(() => client.run("original", "public-A", expected.image, expected.sourceHash, {}), (error: Error) => {
        errors.push(error.message); return true;
      });
      const saved = JSON.parse(readFileSync(join(dir, "original-public-A.json"), "utf8"));
      assert.equal(saved.status, "SUCCESS");
      assert.equal(typeof saved.completedAt, Client === Parent ? "undefined" : "string");
      assert.equal(saved.error, errors.at(-1));
      assert.deepEqual(saved.latest, raw.latest);
      assert.deepEqual(wire.methods, ["POST", "GET"]);
      assert.ok(!JSON.stringify(saved).includes(cfg.token));
      assert.ok(!JSON.stringify(saved).includes(cfg.project));
    } finally { rmSync(dir, { recursive: true, force: true }); }
  }
  assert.equal(errors[0], errors[1]);
});

test("terminal failure is durable before guard hashing and releases only the owned active slot", async () => {
  for (const status of ["SUCCESS", "FAILED", "CANCELLED"]) {
    const { raw, expected } = await metadata();
    raw.latest.status = status;
    raw.latest.metadata.result.stdout.value = "invalid synthetic guest result";
    const dir = mkdtempSync(join(tmpdir(), "repolab-terminal-guard-")), wire = transport(raw);
    try {
      const signal = new AbortController().signal;
      const client = new GuardedFreshPreactSandbox(dir, "original", null, cfg, signal, {
        fetch: wire.fetcher, remote: new FreshPreactSandbox(dir, "original", null, cfg, signal, wire.fetcher),
      });
      await assert.rejects(() => client.run("original", "public-A", expected.image, expected.sourceHash, {}));
      const bytes = readFileSync(join(dir, "original-public-A.json"));
      const saved = JSON.parse(bytes.toString());
      const guard = JSON.parse(readFileSync(join(dir, "guard-original-public-A.json"), "utf8"));
      assert.equal(typeof saved.completedAt, "string");
      assert.equal(guard.rawSha256, shaNative(bytes));
      assert.equal(guard.state, "TERMINAL");
      assert.notEqual(guard.verified, true);
      assert.ok(!existsSync(join(dir, "active-execution.json")));
      const count = wire.methods.length;
      await assert.rejects(() => client.run("original", "public-A", expected.image, expected.sourceHash, {}), /slot already used/);
      assert.equal(wire.methods.length, count);
      assert.deepEqual(readFileSync(join(dir, "original-public-A.json")), bytes);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  }
});

test("uncertain submission and mismatched terminal metadata retain guards without fabricated timestamps", async () => {
  for (const kind of ["lost-post", "identity", "image", "unknown"]) {
    const { raw, expected } = await metadata();
    if (kind === "identity") raw.latest.uuid = randomUUID();
    if (kind === "image") raw.latest.image_uuid = randomUUID();
    if (kind === "unknown") raw.latest.status = "MYSTERY";
    const dir = mkdtempSync(join(tmpdir(), "repolab-terminal-uncertain-")), wire = transport(raw);
    const fetcher: typeof fetch = kind === "lost-post" ? async () => { throw Error("synthetic lost POST"); } : wire.fetcher;
    try {
      const signal = new AbortController().signal;
      const client = new GuardedFreshPreactSandbox(dir, "original", null, cfg, signal, {
        fetch: fetcher, remote: new FreshPreactSandbox(dir, "original", null, cfg, signal, fetcher),
      });
      await assert.rejects(() => client.run("original", "public-A", expected.image, expected.sourceHash, {}));
      const saved = JSON.parse(readFileSync(join(dir, "original-public-A.json"), "utf8"));
      assert.ok(!Object.hasOwn(saved, "completedAt"));
      assert.ok(existsSync(join(dir, "active-execution.json")));
      await assert.rejects(() => client.upload("/opt/repolab/native/public.html", Buffer.from("synthetic"), "next"));
    } finally { rmSync(dir, { recursive: true, force: true }); }
  }
});

test("pre-existing raw bytes and owned source mismatches cannot be rewritten or dispatched", async () => {
  const { raw, expected } = await metadata();
  const dir = mkdtempSync(join(tmpdir(), "repolab-terminal-existing-")), wire = transport(raw);
  const path = join(dir, "original-public-A.json"), bytes = Buffer.from(JSON.stringify(raw));
  try {
    writeFileSync(path, bytes);
    const client = new FreshPreactSandbox(dir, "original", null, cfg, new AbortController().signal, wire.fetcher);
    await assert.rejects(() => client.run("original", "public-A", expected.image, expected.sourceHash, {}));
    await assert.rejects(() => client.run("candidate-1", "public-A", expected.image, expected.sourceHash, {}));
    await assert.rejects(() => client.run("original", "public-A", expected.image, "0".repeat(64), {}));
    assert.deepEqual(readFileSync(path), bytes);
    assert.deepEqual(wire.methods, []);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("new engine audits native rejection then duplicate abstention without independent input or verification", async () => {
  const root = mkdtempSync(join(tmpdir(), "repolab-terminal-engine-"));
  const proposal = exportNativePreactPack().proposal, requests: any[] = [];
  let rawPath = "";
  const options = {
    root, entrypoint: "simulation" as const,
    simulation: {
      fetch: (async (_url, init) => {
        requests.push(JSON.parse(String(init?.body)));
        if (requests.length > 1) {
          assert.equal(typeof JSON.parse(readFileSync(rawPath, "utf8")).completedAt, "string");
        }
        return Response.json({ id: randomUUID(), model: "nvidia/nemotron-3-super-120b-a12b",
          usage: { prompt_tokens: 100, completion_tokens: 200 },
          choices: [{ finish_reason: "stop", message: { content: JSON.stringify(proposal), reasoning_content: "synthetic" } }] });
      }) as typeof fetch,
      remote: (dir: string, variant: string, candidate: unknown) => {
        const fake = fakeFreshRemote(dir);
        return { ...fake, run: async (...args: Parameters<typeof fake.run>) => {
          if (variant === "original" || args[1] !== "lint") return fake.run(...args);
          const { raw } = await metadata(variant, args[1], args[2], candidate, args[4]);
          const guest = JSON.parse(raw.latest.metadata.result.stdout.value);
          guest.completed = false;
          guest.error = "Native stage failed; raw child output retained";
          guest.commands[0].exitCode = 1;
          guest.commands[0].stdout = "synthetic lint failure";
          raw.latest.metadata.result.state.exit_code = 1;
          raw.latest.metadata.result.stdout.value = JSON.stringify(guest);
          rawPath = join(dir, variant + "-" + args[1] + ".json");
          const wire = transport(raw);
          const client = new FreshPreactSandbox(dir, variant, candidate, cfg, new AbortController().signal, wire.fetcher);
          return client.run(...args);
        } };
      },
    },
  };
  try {
    const result = (await runFreshPreact(options))!;
    assert.equal(result.status, "ABSTAINED", result.error ?? undefined);
    assert.equal(result.verified, false);
    assert.equal(requests.length, 3);
    assert.equal(result.candidates[0].status, "NATIVE_REJECTED");
    assert.equal(result.candidates[1].status, "ADMISSION_REJECTED");
    const dir = join(root, "repair-" + result.id);
    const session = createFreshPreactSession(dir, { ...options, id: result.id });
    assert.equal(session.audit().status, "ABSTAINED");
    assert.equal(JSON.parse(readFileSync(join(dir, "selection.json"), "utf8")).accepted, false);
    assert.ok(!existsSync(join(dir, "upload-candidate-1-independent.json")));
    for (const marker of ["independent.html", "stable-rerender", "cleanup-error-boundary", cfg.token, cfg.project])
      assert.ok(!JSON.stringify(requests).includes(marker));
    assert.ok(!existsSync(join(root, "clsx-repair.lock")));
    assert.ok(!existsSync(join(root, "repositories/clsx-repair.lock")));
    const bytes = readFileSync(rawPath);
    writeFileSync(rawPath, Buffer.concat([bytes, Buffer.from(" ")]));
    assert.throws(() => session.audit());
    writeFileSync(rawPath, bytes);
    assert.equal(session.audit().verified, false);
    await assert.rejects(() => runFreshPreact({ ...options, id: result.id }), /already started/);
    assert.equal(requests.length, 3);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("new protocol preserves its parent and rejects substitutions in every correction asset", () => {
  const protocol = auditFreshPreact();
  assert.equal(protocol.newLiveQualificationSlots, 0);
  for (const path of freshAssets)
    assert.throws(() => auditFreshPreact(p => p === path ? Buffer.from("changed") : freshBytes(p)));
});
