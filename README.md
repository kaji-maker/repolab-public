# ReproLab

**Make bugs repeatable. Make fixes reviewable.**

The current supported source-run application is in [`submission-v6/`](submission-v6/). It builds the judge UI locally and connects to the existing authenticated backend at https://repolab.34-71-102-74.sslip.io using the private judge login supplied in the submission testing instructions.

```sh
git clone https://github.com/kaji-maker/repolab-public.git
cd repolab-public/submission-v6
node scripts/source-release-v2.mjs verify . 8dcfee534c47aa7e47406e8f722afbe9cb9a6b450606ffb72a0a32d4c90672d6
npm ci --ignore-scripts --no-audit --no-fund
npm run typecheck
npm run build
npm test
```

Configure the private mode-0600 access file and launch as described in [JUDGE_SOURCE_SETUP.md](submission-v6/JUDGE_SOURCE_SETUP.md). No provider account/key or purchase is required from judges. The source-run local page requires the same judge HTTP login as the hosted app.

The connected UI supports manual fresh Preact repairs, saved-result review, native/public/independent result inspection, operation history, patch inspection and patch download. Backend configuration and saved receipts report `nvidia/nemotron-3-super-120b-a12b` inference on Nebius Token Factory and isolated Nebius Sandbox execution.

This release is a **connected judge client**. It does not independently deploy or reproduce the production backend's protected image, private historical evidence or current ledger. Included backend source is for inspection; equality of the entire deployed backend tree with this public source is not established. The known unlisted-tool/prelaunch integrity gap is documented in the setup guide. These boundaries must remain explicit in the submission and video.

The original root tree and [prior publication README](reference/README-public-main-before-v6.md) remain historical material. Use `submission-v6` for the current setup. The focused release checks are local fixture/build tests and are distinct from actual hosted model/Sandbox work; see the release notes for measured rehearsal results.

MIT licensed; preserve included third-party notices. The benchmark scope remains the exposed Preact ref-cleanup feature with developer-supplied scaffolding and a cached image. No arbitrary-repository or hidden-task success claim is made.
