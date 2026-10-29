# ReproLab — source-run judge client

Build and run the judge interface from source, connected to the existing authenticated ReproLab backend at https://repolab.34-71-102-74.sslip.io.

Start with [JUDGE_SOURCE_SETUP.md](JUDGE_SOURCE_SETUP.md). Node 24.18.0 or newer and the private judge login supplied in the submission's testing instructions are required. For this submission, judges can find the login in the private `JUDGE_TESTING_INSTRUCTIONS.private.md` attachment under Devpost's **Additional info** section. Judges do not supply Nebius credentials or buy credits.

The browser interface supports manual fresh Preact repairs, saved-result review, candidate/operation history, patch inspection and patch download. The backend's recorded configuration and receipts report Nebius Token Factory inference using `nvidia/nemotron-3-super-120b-a12b` and isolated Nebius Sandbox execution. Its configured per-repair bounds are three model calls and 34 operations with accounting/uncertainty checks. The local client delegates these properties to that owner-operated backend; local fixture tests do not independently qualify them. Viewing saved evidence uses GET requests only.

This release's runnable setup uses the owner's hosted backend. It is not an independent deployment of that backend: its original protected image, historical proof inputs and live private accounting state are not public assets. The included backend code is available for source inspection. The previous package's source preview and recorded-review instructions are retained in `reference/PUBLICATION_README_V5.md` and `SUBMISSION_BUILD.md`.

The source-run client binds only to `127.0.0.1`, requires the supplied judge login through browser HTTP authentication, allows only the qualified API routes, and never retries mutations. Judge credentials do not enter JavaScript assets; provider credentials remain exclusively on the hosted backend. The original tests/contracts/evaluators remain separate from generated candidate code.

Use the supported connected setup when reviewing this release. Do not describe it as cross-project image provisioning, arbitrary-repository repair, or a clean independent installation of the production backend. The current feature is the exposed Preact ref-cleanup workflow with developer-provided scaffolding and a cached original image. The incomplete broader study is not a success-rate claim.

License: MIT; preserve included third-party notices.
