# ReproLab

A scoped repair workbench: generate bounded proposals with Nebius Token Factory NVIDIA Nemotron, test admitted source in isolated Nebius Sandbox, select immutable source, then open independent evaluation.

This source-and-recorded-review preview contains a functional local review build and the qualified Preact engine/API/frontend source. **Fresh repair is unavailable in these previews.** A public live judge service has not been qualified. The historical actual result below is not new execution when you open a preview.

## Try the recorded result

Use this repository's **Releases** page to download `repolab-judge-review-v2.zip`, `SHA256SUMS` and `REVIEWER_START.md`. Requires Node 24.18+ and a browser; no npm install, keys, account or credits. Extract the review ZIP into a new directory, keep companion files outside it, and run:

```sh
node server.mjs 4f027be8de254bc95d125ce59f0162479a9ab0e0c548aa907131c5b259678452
```

Open **http://127.0.0.1:4187**. Inspect the saved result, scroll the tested patch, download its exact bytes, review candidate history and restart without credentials. Fresh start stays disabled. Patch SHA-256: `cfa54ecee8c1133134b60f50b92ab053b051e13e9a0c928d5181fff5563ba71d`.

## Build from source

Requires Node 24.18+ and npm:

```sh
npm ci
npm run typecheck
npm run build
npm test
npm start
```

Open **http://127.0.0.1:4188** for the empty-history source preview. It loads no private history or `.env` and admits no fresh repair/recovery. To rebuild the recorded reviewer, follow `reference/SOURCE_README.md`. That file is the preserved source ZIP README, including its packaging-time status. This root README and the manual CI workflow are publication metadata; they do not change the sealed source ZIP or engine/frontend code.

For immutable verification, download `repolab-source-v2.zip`, check SHA-256 `700a488d82fb4424e0f12b8a899a82dd5798ba00c739c2828877d2f53db57a57`, extract separately and verify before installation:

```sh
node scripts/source-release-v2.mjs verify . 5c24f9d630a195f21ca4c7c38c4e0ddb98091146c85873895974c0350953b323
```

The immutable verifier applies to that pristine ZIP extraction, not a Git checkout with `.git`, publication metadata or generated dependencies. The manual CI workflow reconstructs the sealed source files, verifies them and runs setup/build/controller checks with an empty environment. CI is automated remote-environment evidence when run; it is not a human-review attestation.

## Recorded evidence and limits

Actual browser V2, October 25, 2026: **one** production `nvidia/nemotron-3-super-120b-a12b` request and **14** isolated Sandbox operations; candidate 1 independently correct. Native Mocha 29 passed; browser 1,173 passed/11 original skips; core/compat types compile, 17 passed/two pending. Public 3/3 and independent 10/10 repeated after selection. Automatic browser completion and desktop/mobile exact patch review passed. The sanitized summary is `evaluation/browser-release-v2-results-summary.json`.

The task is one exposed Preact ref-cleanup feature with developer-supplied ownership scaffolding and a cached same-project image. No general repair accuracy, hidden-task result or cross-project provisioning claim. The eight-task study is incomplete and unchanged. Browser V1 retains incomplete automatic observation. Original tests/reference/independent checks stay separate from candidate context; their source is visible here and must not be claimed newly hidden after publication.

The source V2 ZIP passed fresh cache-backed offline installation, typecheck/build, ten release groups and five sanitizer groups on the development host. All qualified frontend/portable-review hashes match. The portable ZIP separately passed clean browser and Debian/Alpine checks. Source V1's omitted-SVG failure and earlier browser harness failures remain disclosed in release qualifications.

## Live execution and delivery status

The model provider code, isolated execution guards and qualified repair engine are included as source. Private receipts, execution images, consumed admissions, credentials and run state are excluded; missing prerequisites must fail closed. Neither preview can create a fresh provider run. Do not bypass guards, manufacture evidence, put keys in tests/browser/guests or execute generated candidates locally.

Free live-service judge access, unaided separate-machine setup, video and final submission rehearsal remain separate gates. A review prerelease is not an eligibility claim or completed submission. No usage credit or production secret is requested from a reviewer. Current access URLs and publication/CI status must be read from the actual repository/release and run records, not inferred from packaging-time notes.

ReproLab is MIT licensed (`LICENSE`); upstream and UI dependency notices are in `THIRD_PARTY_NOTICES.md` and the reviewer bundle. Current preview inference: **none**. Execution: **local static review/controller/build only**, with historical actual model/Sandbox activity labeled above.
