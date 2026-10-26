# ReproLab — source release candidate V1

ReproLab uses Nebius Token Factory NVIDIA Nemotron to propose bounded repairs, checks source admission and native/public behavior in isolated Nebius Sandbox, selects immutable source, then opens independent evaluation. This candidate contains the qualified Preact engine/API/frontend source and recorded-review tooling. Original tests, contracts and independent evaluation code remain separate from candidate text. No generated candidate executes on the controller or browser.

## Current result and scope

Actual browser V2, October 25, 2026: one production `nvidia/nemotron-3-super-120b-a12b` request, 14 isolated Sandbox operations, independently correct candidate 1. Native Mocha 29 passed, browser 1,173 passed/11 original skips, core/compat type compilation and 17 passed/two pending; public 3/3 and independent 10/10 repeated after selection. Automatic browser completion and desktop/mobile exact patch review passed. The exported summary is in `evaluation/browser-release-v2-results-summary.json`.

This is one exposed Preact ref-cleanup feature with developer-supplied scaffolding and a same-project cached native image. No hidden-task, cross-project or general repair accuracy claim. The eight-task study remains incomplete and unchanged. Browser V1 retains incomplete automatic observation. The recorded result is supporting evidence; this source export is not a new live run or independent provider-receipt verification.

## Clean setup

Requires Node 24.18+ and npm. From this directory:

```sh
npm ci
npm run typecheck
npm run build
npm test
npm start
```

Open **http://127.0.0.1:4188**. The source preview shows the exact qualified frontend with **empty history and fresh start disabled**. It never imports private saved history, loads `.env`, admits repair, or performs automatic recovery. Its only local state is an ignored preview SQLite file. Stop with Ctrl+C. The release-specific package scripts replace the development scripts; `reference/package.original.json` preserves the original package metadata. Engine/API/frozen source bytes are copied unchanged.

To review the recorded actual result without private state, create the portable review directory (new destination outside the checkout):

```sh
node scripts/judge-review-bundle-v2.mjs create /absolute/new/review-directory
```

Use its returned manifest SHA-256 with `node /absolute/new/review-directory/server.mjs TRUSTED_MANIFEST_SHA256`, then open port **4187**. That build requires no credentials or credits and makes no new inference/Sandbox calls. The selected patch is rendered as text. The separate unchanged prebuilt review ZIP and concrete trusted checksum/start instructions are supplied in the release handoff. For source integrity, use `node scripts/source-release-v1.mjs verify . TRUSTED_SOURCE_MANIFEST_SHA256` before installation/build; generated dependencies/state/build files are intentionally outside the immutable source manifest.

## Live-source boundary

Live inference code is in `packages/providers/nebius.ts`; isolated execution/guard code is under `packages/execution` and `packages/repositories`. The qualified engine is `packages/repositories/preact-repair-v4.ts`, API `apps/api/preact-repair-v4.ts`, frontend `apps/web/src/FreshPreactV9.tsx`. Frozen historical protocols and controller checks explain selection, uncertainty and accounting behavior.

**No dispatch admission is distributed.** Historical live entrypoints require authoritative original qualification, raw evidence, execution freezes and consumed capabilities, which are private and excluded. Missing files must fail closed. Do not remove guards, fabricate receipts, reuse consumed IDs or treat absent cloud locks as permission. Provider credentials alone cannot enable the source preview or portable reviewer. Original dependency images and separate-project provisioning are not reproduced by this export. Completing a public live-service judge journey is separate work requiring a new reviewed deployment/access plan; this candidate grants no new inference/compute run.

Only an explicitly authorized production service may load owner-managed server-side provider credentials. Never place credentials in the source release, browser, tests, guest processes or candidate messages. There is no `.env` in this export. Do not run arbitrary generated code locally.

## Repository map

- `apps`, `packages`: qualified product and its transitive source dependencies, with frozen historical engine components.
- `tests`, `fixtures`, `evaluation`: selected controller checks, reviewed fixture data and protocol/reference code. Independent checks remain separate from model repair inputs. Their inclusion makes the source candidate reviewable; never claim these exposed checks are hidden benchmark results.
- `apps/judge-review-v2`, `scripts/judge-review-bundle-v2.mjs`: standalone recorded-review source and exact asset packaging.
- `release/source-v1`: release documentation and package templates; `SOURCE_MANIFEST.json` lists exact export hashes.

## Licenses and delivery status

ReproLab is MIT licensed: `LICENSE`. Preact patch/source text and bundled UI dependencies retain notices under `apps/judge-review-v2`; npm dependency licenses come with their pinned packages. See `THIRD_PARTY_NOTICES.md`. This is a local, unpublished source candidate, not a public repository or submitted project. Publication/hosting/submission need specific owner authorization. Free live-service judge access, unaided separate-machine review, genuine video, submission rehearsal and availability through judging remain open.

Current source preparation inference: **none**. Execution: **reviewed controller/build/preview and recorded-review checks only**, zero new Sandbox operations or candidate/original/observer execution. Historical actual results are labeled separately above.
