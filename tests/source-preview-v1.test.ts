import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSourcePreview } from "../apps/api/source-preview-v1.ts";

test("source preview never loads private history or provides a fresh admission", async () => {
  const root = await mkdtemp(join(tmpdir(), "repolab-source-preview-"));
  const preview = createSourcePreview(0, join(root, "preview.sqlite"));
  const port = await preview.start(), base = `http://127.0.0.1:${port}`;
  try {
    const response = await fetch(base + "/api/native-preact-repairs-v4");
    assert.equal(response.status, 200);
    const value = await response.json() as any;
    assert.deepEqual(value.history, []); assert.equal(value.readiness.available, false);
    for (const route of ["", "/8e33657a-d655-4d4b-80d3-2a432058ceed/cancel", "/8e33657a-d655-4d4b-80d3-2a432058ceed/recover"]) {
      const response = await fetch(base + "/api/native-preact-repairs-v4" + route, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      assert.equal(response.status, 409);
    }
    assert.equal((await fetch(base + "/api/native-preact-repairs-v4/8e33657a-d655-4d4b-80d3-2a432058ceed")).status, 404);
    assert.equal((await fetch(base + "/api/native-preact-repairs-v4/8e33657a-d655-4d4b-80d3-2a432058ceed/patch")).status, 409);
    assert.equal((await fetch(base + "/api/native-preact-repairs-v4", { headers: { Origin: "https://untrusted.invalid" } })).status, 403);
    assert.equal((await fetch(base + "/api/native-preact-repairs-v4", { method: "POST", headers: { "Content-Type": "application/json" }, body: '{"source":"injected"}' })).status, 400);
  } finally { await preview.close(); }
});
