# ReproLab recorded review V3

This read-only bundle displays the recorded October 25 qualification and the **compact equivalent patch** in its inspect and download controls. The original recorded patch, its original SHA-256, the compact patch's three base files, license, and expected output hashes are retained in `data/`.

The compact diff has a different SHA-256 from the original whole-file patch. It applies to the included base files and produces the exact output file hashes listed in `data/patch-base/expected.sha256`. This proves byte equivalence of the resulting files, not semantic correctness. The page labels the compact patch and shows both patch hashes.

## Start

Requires Node 24.18+ and a current browser. No npm install, build, credentials, account, provider access, or paid credits are needed. Keep all extracted files together. Obtain the trusted manifest SHA-256 from a separate handoff; a digest beside an untrusted executable alone does not establish publisher identity.

```sh
node server.mjs TRUSTED_MANIFEST_SHA256
```

Open http://127.0.0.1:4187 directly. Stop with Ctrl+C. The server binds only to loopback, serves verified in-memory bytes, rejects mutations and cross-origin requests, writes no state, and makes no outbound requests or child processes. If an extension or embedded browser is rejected, open the loopback URL directly in a browser tab.

## Reviewer path

1. Review the saved run and distinguish its historical inference/execution provenance from this local static review.
2. Use **Inspect compact equivalent patch** and **Download compact equivalent patch**. The compact patch SHA-256 is `834fd027fb8433a7fc6eb8ab9d8f81521c52d5fb85fc5ee76f9d7e0754135e52`.
3. Compare the original recorded patch, preserved at `data/patch.recorded.patch`, to its SHA-256 `cfa54ecee8c1133134b60f50b92ab053b051e13e9a0c928d5181fff5563ba71d`. The compact version changes diff formatting and is not byte-identical to that recorded artifact.
4. To verify the compact patch without executing source code, make a new temporary source directory and place the three included base files at the paths shown below. Then run:

```sh
mkdir -p /tmp/preact-patch-check/src/diff
cp /path/to/review/data/patch-base/diff-index.js /tmp/preact-patch-check/src/diff/index.js
cp /path/to/review/data/patch-base/diff-children.js /tmp/preact-patch-check/src/diff/children.js
cp /path/to/review/data/patch-base/internal.d.ts /tmp/preact-patch-check/src/internal.d.ts
cd /tmp/preact-patch-check
git apply --check /path/to/review/data/patch.patch
git apply /path/to/review/data/patch.patch
sha256sum -c /path/to/review/data/patch-base/expected.sha256
```

5. `data/review.json` is the unchanged recorded API projection; `data/result.json` is its portable result summary. The browser's display adds the original patch digest and labels the compact patch as an equivalent representation.

## Limits

This records one exposed Preact ref-cleanup feature with developer-supplied scaffolding and a same-project cached image. It is not a hidden benchmark or general repository repair result. The historical native browser count includes 11 skips; type evaluation includes two pending cases. The bundle contains no live admission, makes no new inference or Sandbox calls, and cannot start a fresh repair. It does not establish continued provider availability, another-device compatibility, semantic correctness of the patch, or screen-reader behavior.

ReproLab is MIT licensed. Bundled React, React DOM, Scheduler, and Preact source retain their license notices. Candidate, original, and observer source are never executed; patch text is only rendered/downloaded.
