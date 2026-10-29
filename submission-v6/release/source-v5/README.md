# ReproLab — source and reviewer candidate V5

This candidate contains the V5 read-only source preview, the V3 recorded-review builder that displays the compact equivalent Preact patch, and source for the currently hosted V2 runtime. The preview's fresh-repair button explains why it is disabled; the source archive contains no private runtime state, provider credentials, dependency authority, or dispatch admission and cannot start a repair. The hosted V2 service remains separately operated with its private, pinned authorities. V5's V6 preview build and V3 review assets are additive; V4's build and review path are retained unchanged.

The ZIP is a source/test-build candidate. It is not itself a deployment image and does not grant access to the hosted service. `apps/api/cloud-live-server-v2.mjs` and its runtime modules are included for source completeness, but startup fails closed when the host-only source/dependency freezes, the host dependency package lock, and private run state are absent. Do not add those private files to the release. The separate owner provisioning helper is excluded.

See `SUBMISSION_BUILD.md` for how this source package, the hosted V2 demo, and the portable recorded review relate.

## Verify before setup

Obtain the trusted source-manifest SHA-256 from the separate `REVIEWER_START.md` supplied by the owner. In the untouched extracted directory, run:

```sh
node scripts/source-release-v2.mjs verify . TRUSTED_SOURCE_MANIFEST_SHA256
```

Then, with Node 24.18+ and npm (the tested install skips dependency lifecycle scripts):

```sh
npm ci --ignore-scripts
npm run typecheck
npm run build
npm test
npm start
```

Open http://127.0.0.1:4188. The preview has empty history, the repair button is disabled with an explanation, and no candidate or provider request is made. Stop with Ctrl+C. `npm test` runs focused source-preview, recorded-review, hosted-runtime integrity, read-only provider-preflight fixture, and synthetic guard checks; it is not the full historical development suite. Provider tests use stubs only and do not contact providers or start paid work.

## Review the recorded repair

Build a portable V3 recorded-review directory outside the source tree:

```sh
npm run review:build -- create /absolute/new/review-directory
node /absolute/new/review-directory/server.mjs TRUSTED_REVIEW_MANIFEST_SHA256
```

Open http://127.0.0.1:4187 directly in the browser. This V3 page displays and downloads the **compact equivalent patch**. It retains the original recorded patch and its SHA separately. The compact patch's output file hashes match the original recorded patch's output, but the patch bytes and digest differ. Read `apps/judge-review-v3/README.md` for the review path and offline apply check.

The preview and recorded-review server are local read-only views. They make no new inference or Sandbox calls; the saved run's provenance remains historical and separately labeled. No credentials, private run state, hidden evaluation inputs, or live admission are included.

## Evidence limits

The historical recorded run covers one exposed Preact ref-cleanup feature with developer-supplied scaffolding and a same-project cached image. It does not establish hidden-task accuracy or cross-project portability. Native browser tests include 11 original skips and type evaluation includes two pending cases. The current hosted service was upgraded and independently requalified under its V2 dependency freeze; those later results are documented separately and are not represented by the October 25 record in this review page.

The hosted V2 implementation uses the same qualified engine with a manually started, authenticated backend. Its current source/dependency authorities are `75a853e5be44334449705554f734478d045972670419ab487d8289c0722cac10` and `123aedef027e87efb2e96a6cbc0c72bc074e5be4eb21cc2aceed4205f60c7703`. Those private deployment freezes and retained run state are not included. The V5 preview and October 25 review remain read-only and distinct from hosted run `b2a8768c-acae-4ed4-8565-8725a5fa0120`.

The V2 host uses Hono 4.13.14, Zod 4.6.7, Vite 7.3.7 and source-map-js 1.2.2. No package advisories were reported at the respective qualification times; advisories can change. The V5 source-review candidate is local and unpublished. See `LICENSE` and `THIRD_PARTY_NOTICES.md`.
