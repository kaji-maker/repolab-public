# ReproLab

**Make bugs repeatable. Make fixes reviewable.**

ReproLab is a scoped repair workbench for a coding agent. NVIDIA Nemotron, served by Nebius Token Factory, proposes bounded repairs. Nebius Token Factory Sandboxes run the project's real test suites in isolated, disposable environments. A candidate is only selected after native, public and independent checks pass, and the result is shown with its patch, counts and provenance.

> **Status of this repository: read this first.** This repository gives you (1) a read-only source preview, (2) a portable recorded review of a real run, and (3) the source of the hosted application. **It does not let you start a live repair on your own machine.** The live application is the separately hosted, authenticated demo described in the submission's testing instructions. The gap between the public source and the hosted service is open and documented below.

### Where the source is

The files on the `main` branch are the earlier **V2 source package (669 files)** published on October 26, 2026. The **current source package is the V5 release asset** `repolab-source-v5.zip` (716 files) on the [`v0.2.0-review-v5` release](https://github.com/kaji-maker/repolab-public/releases/tag/v0.2.0-review-v5), published on October 27, 2026. The release also carries `SHA256SUMS`, `SOURCE_MANIFEST.json`, `REVIEWER_START.md` and `RELEASE_NOTES.md`. The setup steps below use the V5 ZIP, not the files on `main`.

## Three things, kept separate

| Artifact | What it is | Fresh model or Sandbox calls |
| --- | --- | --- |
| **Hosted demo** (authenticated; judge login is in the submission testing instructions) | The live application. A signed-in user can inspect saved runs and patches and can start a new repair, which uses the owner's Nebius project. | Yes, when a user starts a repair. Opening saved results makes none. |
| **V5 source package** (release `v0.2.0-review-v5`, `repolab-source-v5.zip`) | 716 source files. Builds and runs a **read-only** preview. Includes the hosted application's server and runtime modules for inspection. | None. Fresh repair is disabled. |
| **Portable recorded review** (`repolab-recorded-review-v3.zip`) | Replays one historical run from October 25, 2026 with its exact patch. | None. |

The recorded review is a saved October 25 run. It is not a reproduction of the hosted service and not the hosted run `b2a8768c-acae-4ed4-8565-8725a5fa0120`.

## What a fresh installation can and cannot do

**Can** (each step verified on a clean extraction, with no credentials):

- Check the release digests and verify all 716 source files against the manifest before installing.
- `npm ci --ignore-scripts`, typecheck, build, and run the 79 focused tests.
- Start the read-only preview on `http://127.0.0.1:4188`. It loads no private history, shows an empty history, and explains why starting a repair is disabled.
- Rebuild the recorded review, serve it on `http://127.0.0.1:4187`, download the exact patch, check its hash, and apply it to the included base files.
- Read the model-provider, Sandbox-guard, accounting and repair-engine source.

**Cannot:**

- **Start a live repair.** The preview refuses every start, cancel and recovery request.
- **Run the hosted service.** `apps/api/cloud-live-server-v2.mjs` is included in the V5 ZIP (it is not on `main`), but it needs host-only inputs that are deliberately not in the package: the exact runtime source freeze, the original deployment snapshot, a dependency freeze, provider configuration, persistent run state and the owner's qualified Sandbox base image. Without them it refuses to start. That refusal is the safety design, and nothing in this repository should be changed to bypass it.
- **Create its own qualified Sandbox image.** The hosted service's base image is a snapshot inside the owner's Nebius project. The repository contains no code that imports the Node base image or qualifies a new image, and moving the image to another project is untested.
- **Reproduce the hosted run's evidence.** Private run history is excluded.

### The open gap

The competition requires the public repository to contain what the project needs to function. This repository does not yet contain a path that lets a new installer run the live application. The gap is open, not closed. What would close it:

1. New versions of the native, admission, trial and protocol layers that take the Sandbox image from the installer's own qualification instead of the owner's pinned image, then a repair engine and a launcher on top. These do not exist yet.
2. The installer imports the public `node:20.9.0-bookworm-slim` image into their own Nebius project and qualifies it: at least 39 Sandbox operations (1 import, 12 native, 26 admission), at the installer's cost. No import code exists in this repository, and cross-project image portability is untested.
3. A repair engine that refuses to start, before any claim or provider call, unless it has verified fresh authority and real prior qualification evidence. A first piece (a locally generated fresh-install authority and a pre-dispatch evidence gate) has been written and tested with synthetic fixtures only; it is not part of the published packages.

Judges can see the live application only through the hosted demo.

## Setup (read-only preview)

Requires Node 24.18+ and npm. Download `repolab-source-v5.zip`, `SHA256SUMS` and `REVIEWER_START.md` from the release. Extract into a new directory, then:

```sh
sha256sum repolab-source-v5.zip     # expect 3955d22ea27f5a7385c861720448f948c8c951a322f9e92a5b245add4f42ae04
node scripts/source-release-v2.mjs verify . 4835eb04f8b14eb380618135be6bb2d7dc1c885ce35c896410c1396dff938001
npm ci --ignore-scripts
npm run typecheck
npm run build
npm test            # 79 focused tests
npm start           # read-only preview at http://127.0.0.1:4188
```

Run the manifest verification **before** `npm ci`; it rejects the unlisted `node_modules` directory afterward.

Recorded review:

```sh
npm run review:build -- create /absolute/new/review-directory
node /absolute/new/review-directory/server.mjs de6511e26f23de407616ea341afd275a466a74244b694967c2309b6a0d6835b8
```

Open `http://127.0.0.1:4187`. The compact patch (`834fd027…3e52`) and the original recorded patch (`cfa54ece…a71d`) have different bytes and produce the same three expected files; byte equivalence does not establish correctness. `REVIEWER_START.md` has the exact patch-application steps. Do not run patched code.

No credential or account is needed for any step above.

## How it uses Nebius and NVIDIA

- **Nebius Token Factory**, OpenAI-compatible endpoint, model **`nvidia/nemotron-3-super-120b-a12b`** (NVIDIA Nemotron) proposes bounded repairs against a sourced bug report. Estimated list price used for accounting: $0.30 per million input tokens and $0.90 per million output tokens. Token usage is recorded per request.
- **Nebius Token Factory Sandboxes** run every test and candidate in isolated, disposable instances. Candidate code never runs on the controller host.
- Per repair: at most 3 model calls and candidates, and 34 isolated operations. There is no overall run quota or service-wide spending cap; these per-repair bounds, the usage accounting and the uncertainty holds stay in force.
- The hosted demo itself runs on a Google Cloud VM. It is not hosted on Nebius.

## Recorded evidence and limits

- Hosted run `b2a8768c-acae-4ed4-8565-8725a5fa0120` (October 27, 2026): `ACCEPTED_INDEPENDENTLY_CORRECT`; 2 Nebius model calls (estimated $0.0224541, Sandbox charges separate); 14 isolated Sandbox operations; native Mocha 29/29, browser 1173/1184 with 11 original skips, types 17 pass / 2 pending, public 3/3, independent 10/10. Saved patch: 80,593 bytes, SHA-256 `cdd06dd2b3242de378dcdd5a4a14705a23ba0dc779f2dd1f55dd9ab470f9bad4`.
- The task is **one** exposed Preact ref-cleanup feature (`preactjs__preact-4436`) with developer-supplied scaffolding and a cached same-project image. Five saved runs exist in the hosted catalog, all on this one task. This is not a general repair-accuracy result, a hidden-task result, or evidence of onboarding another project.
- The eight-task study is incomplete and unchanged. The original tests, reference and independent checks are visible in this repository and must not be treated as hidden.
- Full VM reboot of the hosted service has not been tested.

## Dependencies

Node.js 24.18 or newer and npm with the committed lockfile (`npm ci --ignore-scripts`). Four runtime packages, pinned exactly: `hono` 4.13.14, `zod` 4.6.7, `react` and `react-dom` 19.2.8. Dev tooling: `vite` 7.3.7, `typescript` 6.0.3, `playwright` 1.63.0, `prettier` 3.9.7 and the Node and React type packages. The lockfile (V5) pins 78 packages, all from `registry.npmjs.org` with integrity hashes. Licenses across the lock: MIT 73, Apache-2.0 3, ISC 1, BSD-3-Clause 1. Registry access is needed only to install.

The live application additionally needs services that are not in any package: a Nebius Token Factory API key and project, Sandbox beta access with `spawn`, `spawn_disposable` and `cancel` permissions, and a qualified Sandbox base image in the same project.

## License

MIT (`LICENSE`). Upstream and UI dependency notices are in `THIRD_PARTY_NOTICES.md`. Recorded patch and fixtures derive from `preactjs/preact` (MIT, copyright 2015-present Jason Miller).
