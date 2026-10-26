import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Store } from "../packages/storage/store.ts";
import { createQualifiedPreactApp } from "../apps/api/preact-repair-v4.ts";
import { nativeReviewDisposition } from "../packages/repositories/native-review-display-v2.ts";
import { readFileSync } from "node:fs";
import { validateWorkbenchPins, workbenchAssets, workbenchBytes } from "../packages/repositories/preact-workbench-protocol-v1.ts";

const base = "http://127.0.0.1:4185";
const prefix = "/api/native-preact-repairs-v4";
const req = (route = "", body?: unknown, headers: Record<string, string> = {}) => new Request(base + prefix + route, {
  method: body === undefined ? "GET" : "POST", headers: { ...(body === undefined ? {} : { "Content-Type": "application/json" }), ...headers },
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});
const history = { list: async () => [], get: async (_id: string) => null, patch: async (_id: string): Promise<string> => { throw Error("Unverified"); } };
function fixture(settings: { consumeFailure?: boolean; blocked?: boolean; noAdmission?: boolean } = {}) {
  const store = new Store(":memory:"), id = randomUUID();
  let claims = 0, calls = 0, options: any;
  const app = createQualifiedPreactApp(store, 4185, { history, blocked: () => !!settings.blocked,
    ...(!settings.noAdmission ? { admission: { id, readiness: () => ({ available: true, reason: "synthetic admission" }), consume: async () => {
      claims++; if (settings.consumeFailure) throw Error("synthetic claim failure");
    } } } : {}),
    execute: async (value = {}) => {
      calls++; options = value;
      await new Promise<void>(ok => { if (value.signal!.aborted) ok(); else value.signal!.addEventListener("abort", () => ok(), { once: true }); });
      return {} as any;
    },
  });
  return { store, app, id, claims: () => claims, calls: () => calls, options: () => options,
    close: async () => { await app.close(); store.close(); } };
}
test("V4 saved review is keyless and no admission means no start even with an injected executor", async () => {
  const w = fixture({ noAdmission: true });
  try {
    const response = await w.app.app.fetch(req());
    assert.equal(response.headers.get("Cache-Control"), "no-store");
    assert.equal((await response.json()).readiness.available, false);
    assert.equal((await w.app.app.fetch(req("", {}))).status, 409);
    assert.equal(w.calls(), 0); assert.equal(w.claims(), 0);
  } finally { await w.close(); }
});
test("V4 refuses untrusted hosts/origins and source/model/test/credential/run overrides", async () => {
  const w = fixture();
  try {
    for (const headers of [{ Origin: "https://untrusted.invalid" }, { "Sec-Fetch-Site": "cross-site" }] as Record<string, string>[])
      assert.equal((await w.app.app.fetch(req("", {}, headers))).status, 403);
    assert.equal((await w.app.app.fetch(new Request("http://evil.invalid" + prefix))).status, 403);
    for (const body of [{ source: "return true" }, { tests: [] }, { model: "other" }, { apiKey: "synthetic" }, { id: randomUUID() }, { operationId: randomUUID() }, { admission: true }])
      assert.equal((await w.app.app.fetch(req("", body))).status, 400);
    assert.equal(w.calls(), 0); assert.equal(w.claims(), 0);
  } finally { await w.close(); }
});
test("V4 refuses malformed/oversized/non-JSON actions and invalid read identities", async () => {
  const w = fixture();
  try {
    for (const [body, type, status] of [["{", "application/json", 400], ["{}", "text/plain", 415], [" ".repeat(16001), "application/json", 413]] as const)
      assert.equal((await w.app.app.fetch(new Request(base + prefix, { method: "POST", headers: { "Content-Type": type }, body }))).status, status);
    assert.equal((await w.app.app.fetch(req("/not-an-id"))).status, 404);
    assert.equal((await w.app.app.fetch(req("/" + randomUUID()))).status, 404);
    assert.equal(w.calls(), 0);
  } finally { await w.close(); }
});
test("V4 never dispatches legacy mutations or automatic recovery", async () => {
  const w = fixture();
  try {
    for (const route of ["/api/runs", "/api/native-preact-repairs", "/api/native-preact-repairs-v2", "/api/native-preact-repairs-v3", "/api/native-selected-v4/replays"])
      assert.equal((await w.app.app.fetch(new Request(base + route, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }))).status, 409);
    assert.equal((await w.app.app.fetch(req("/" + w.id + "/recover", {}))).status, 409);
    assert.equal(w.calls(), 0); assert.equal(w.claims(), 0);
  } finally { await w.close(); }
});
test("V4 consumes a prebound capability once, calls the qualified API engine and only cancels its own run", async () => {
  const w = fixture();
  try {
    const response = await w.app.app.fetch(req("", {}));
    assert.equal(response.status, 202); assert.equal((await response.json()).id, w.id);
    await new Promise(ok => setImmediate(ok));
    assert.equal(w.claims(), 1); assert.equal(w.calls(), 1);
    assert.equal(w.options().id, w.id); assert.equal(w.options().entrypoint, "api");
    assert.equal((await w.app.app.fetch(req("", {}))).status, 409);
    assert.equal((await w.app.app.fetch(req("/" + randomUUID() + "/cancel", {}))).status, 409);
    assert.equal((await w.app.app.fetch(req("/" + w.id + "/cancel", {}))).status, 202);
    await new Promise(ok => setImmediate(ok));
    assert.equal(w.options().signal.aborted, true);
    assert.equal((await w.app.app.fetch(req("", {}))).status, 409);
  } finally { await w.close(); }
});
test("V4 failed admission cannot execute or restore a consumed capability", async () => {
  const w = fixture({ consumeFailure: true });
  try {
    assert.equal((await w.app.app.fetch(req("", {}))).status, 202);
    await new Promise(ok => setImmediate(ok));
    assert.equal((await w.app.app.fetch(req("", {}))).status, 409);
    assert.equal(w.claims(), 1); assert.equal(w.calls(), 0);
  } finally { await w.close(); }
});
test("V4 shared execution or unsettled inference blocks capability consumption", async () => {
  for (const kind of ["execution", "accounting"]) {
    const w = fixture({ blocked: kind === "execution" });
    if (kind === "accounting") w.store.reserve("synthetic-account", 1, 10);
    try {
      assert.equal((await w.app.app.fetch(req("", {}))).status, 409);
      assert.equal(w.claims(), 0); assert.equal(w.calls(), 0);
    } finally { await w.close(); }
  }
});
test("fixture, abstained, uncertain and independently incorrect outcomes never acquire a proof badge", () => {
  const record = { verified: true, simulated: false, active: false, accepted: true, status: "ACCEPTED_INDEPENDENTLY_CORRECT", sourceHash: "a".repeat(64), native: {}, public: { passed: 3, total: 3 }, independent: { passed: 10, total: 10 } };
  assert.equal(nativeReviewDisposition(record).proofBadgeAllowed, true);
  for (const change of [{ simulated: true }, { verified: false }, { active: true }, { accepted: false }, { status: "ABSTAINED" }, { status: "ACCEPTED_INDEPENDENTLY_INCORRECT" }, { independent: { passed: 9, total: 10 } }, { sourceHash: null }])
    assert.equal(nativeReviewDisposition({ ...record, ...change }).proofBadgeAllowed, false);
});
test("workbench pins reject every source substitution and live/legacy policy expansion", () => {
  const protocol = JSON.parse(readFileSync("evaluation/preact-workbench-v1.json", "utf8"));
  validateWorkbenchPins(protocol);
  for (const path of workbenchAssets)
    assert.throws(() => validateWorkbenchPins(protocol, p => p === path ? Buffer.from("changed") : workbenchBytes(p)));
  for (const change of [{ newLiveQualificationSlots: 1 }, { defaultServerAdmission: true }, { legacyDispatch: true }, { automaticRecovery: true }])
    assert.throws(() => validateWorkbenchPins({ ...protocol, ...change }));
});
