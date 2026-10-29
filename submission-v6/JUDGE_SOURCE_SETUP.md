# Run the judge application from source

## Prerequisites

- Linux or macOS, Node 24.18.0 or newer, npm, and a browser. The focused TLS fixture also uses the OpenSSL CLI; it is not required to run the client.
- Network access to the npm registry for installation and to the ReproLab HTTPS backend during use.
- The private judge username/password supplied with the submission. No provider API key or Nebius account is required on the judge's computer.

## Install and run

Verify the source manifest using the digest supplied beside the release ZIP before installing:

Checksums detect corruption relative to a separately obtained digest; the verifier in the archive is source code to review, and a checksum supplied with the same archive does not independently authenticate its publisher.

```sh
node scripts/source-release-v2.mjs verify . MANIFEST_SHA256_FROM_RELEASE
npm ci --ignore-scripts --no-audit --no-fund
npm run typecheck
npm run build
npm test
```

Copy `judge-access.example.json` to a private location outside the source checkout, replace its placeholders with the supplied judge login, and restrict permissions:

```sh
cp judge-access.example.json /private/path/repolab-judge-access.json
chmod 600 /private/path/repolab-judge-access.json
REPOLAB_JUDGE_ACCESS_FILE=/private/path/repolab-judge-access.json npm start
```

Visit **http://127.0.0.1:4189** and enter the same supplied judge login at the browser's HTTP-authentication prompt. The server loads `dist/web-judge` built from `apps/web/src/FreshPreactV9.tsx` and forwards the supported repair API to the pinned HTTPS ReproLab origin. The access file is read only by the local Node server. It must never be committed or copied into `dist`, a release, a screenshot, or a web-page field. Browser HTTP authentication retains the judge login in its own session; it does not expose it to the UI JavaScript.

The launcher refuses known provider variables and listed TLS/loader overrides (`NODE_OPTIONS`, `NODE_PATH`, `NODE_TLS_REJECT_UNAUTHORIZED`, extra CA settings, `OPENSSL_CONF`, `NODE_USE_SYSTEM_CA`, `NODE_USE_ENV_PROXY`). This is a best-effort setup guard; the local machine and Node installation are trusted. Run it from a clean terminal with only the judge access-file path. `REPOLAB_JUDGE_PORT` may select another local port. Stop with Ctrl+C. A setup error prints a safe stage code (`environment`, `access-file`, `web-build`, `configuration`, or `listen`) without credential values.

## Judge journey

1. Open an owner-recorded run marked independently verified by the backend's controller evaluation. Inspect its model, execution, native/public/independent results, candidate history, and operation IDs. The badge denotes those engine checks, not an independent human or deployment attestation.
2. Choose **Inspect tested patch**, then **Download tested patch**. The displayed SHA-256 identifies the downloaded patch.
3. To run the actual supported workflow, choose **Start fresh repair** once. This uses the owner's funded hosted backend; a repair can take several minutes. The page observes its durable status automatically. A failure or abstention is retained as evidence. Do not repeatedly click or retry an uncertain operation.
4. The backend permits one workflow at a time. If accounting, an execution lease, or provider access blocks admission, the readiness message explains that stop. Inspect saved results while the owner resolves it.

The local server is not a general proxy and never accepts provider keys, run overrides, arbitrary upstream URLs, or arbitrary filesystem paths from browser requests. The private access file controls one HTTPS backend origin. Only the qualified empty-JSON start/cancel/recover routes and saved-result/patch GETs are forwarded; mutations are never automatically retried.

If a mutation response is lost or refused, its outcome is unknown. Inspect saved history before acting; the local client blocks another start until it is restarted after that review. It also refuses concurrent mutations. An HTTP error does not prove that no backend work started.

## Deployment scope and evidence

The source package is runnable in **connected judge-client mode**. The production backend remains the existing owner deployment. Its original immutable source proof includes private historical evidence, a protected same-project image and the current private ledger; those are runtime prerequisites for reconstructing that exact deployment, not public source supplied by this release. Never initialize a new controller from the historical ledger, fabricate old evidence, disable its proof, or claim this package independently provisions a fresh Nebius project.

There is a known production integrity gap: the draft V2 whole-tree prelaunch gate fails because two unlisted private qualification/audit tools are present, and that gate has not been installed. End-to-end equality of this source release and the deployed backend is not established. This remains a blocker for claiming complete independent backend reproduction. The connected client does not change that tree or relax its existing dispatch/accounting checks. The current audit wrapper's original source history is unavailable and it is excluded from this release.

The recorded-only preview remains available through `npm run preview:recorded`. That preview makes no fresh repair. The connected client's **Start fresh repair** action delegates to the existing qualified backend; source installation itself authorizes no provider dispatch.

The host must stay available free of charge through the judging period. Judge access delivery and final hosting/provider coverage are owner responsibilities; a successful point-in-time rehearsal does not guarantee future account balance or uptime.

The shared judge login is owner-operated and can start funded runs. Keep the current shared-login/one-workflow policy explicit; the client adds no new service-wide spending cap. The owner can rotate/revoke access after judging and must update the judge instructions if credentials change before judging ends.

Inference provenance: no inference during source installation, build, fixture tests, or startup. Execution provenance: build/controller fixtures and browser transport locally; actual candidate, original, and observer code executes only in the hosted isolated Sandbox when a manual repair is started.
