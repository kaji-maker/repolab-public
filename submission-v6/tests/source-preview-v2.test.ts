import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSourcePreviewV2 } from "../apps/api/source-preview-v2.ts";

test("V5 source preview explains the disabled action and rejects dispatch", async () => {
  const root = await mkdtemp(join(tmpdir(), "repolab-source-preview-v5-"));
  const preview = createSourcePreviewV2(0, join(root, "preview.sqlite"));
  const port = await preview.start(), base = `http://127.0.0.1:${port}`;
  try {
    const page = await fetch(base + "/");
    assert.equal(page.status, 200);
    assert.match(await page.text(), /Read-only source review V5/);
    const catalog = await fetch(base + "/api/native-preact-repairs-v4");
    assert.equal(catalog.status, 200);
    const value = await catalog.json() as any;
    assert.deepEqual(value.history, []);
    assert.equal(value.readiness.available, false);
    for (const route of ["", "/8e33657a-d655-4d4b-80d3-2a432058ceed/cancel", "/8e33657a-d655-4d4b-80d3-2a432058ceed/recover"]) {
      const response = await fetch(base + "/api/native-preact-repairs-v4" + route, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: "{}",
      });
      assert.equal(response.status, 409);
    }
    assert.equal((await fetch(base + "/api/native-preact-repairs-v4", { headers: { Origin: "https://untrusted.invalid" } })).status, 403);
  } finally { await preview.close(); }
});
