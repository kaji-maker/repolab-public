# ReproLab connected judge client V6 — October 29, 2026

This additive release provides a source-run judge client for the existing authenticated ReproLab backend. The public repository's `submission-v6/` directory is the supported source path; the original root tree and earlier V5 release remain historical material. The client requires the supplied private judge login, with no provider key, Nebius account or payment from judges.

The backend remains an owner-hosted dependency. This release does not establish independent backend deployment, cross-project image portability, equality of the complete production tree and public source, or resolution of the production whole-tree prelaunch failure. Those limits are stated in `JUDGE_SOURCE_SETUP.md` and the repository README. The previously untracked audit wrapper is excluded.

## Source qualification

- Exact source manifest: 722 files; ZIP 723 members; manifest/hash verification and ZIP CRC check pass.
- Clean installation with lifecycle scripts disabled, typecheck, both builds and 91 focused synthetic/controller tests pass on Linux / Node 24.18.0.
- Twelve new relay fixtures cover local Basic authentication, Host/Origin/path boundaries, concurrent/uncertain mutations, upstream 5xx stops, redirect/reflection refusal, negative real TLS, private access-file/launcher boundaries, and patch attachment routing.
- Dependency audit reports zero known advisories at this check.
- Known configured provider secret/project values and judge credentials, including examined encoded forms, have zero matches in the listed source and built client assets. This is a bounded privacy check, not proof against every possible encoding.
- Two tool-disabled Claude static reviews informed fixes. The final upstream-5xx guard and launcher refinements were reviewed locally and exercised by fixtures; no third independent review or independent human review is claimed.

## Actual hosted repair and browser checks

The owner authorized one additional paid repair. The source-run client admitted exactly one start, run `de9e9cdd-45b1-4034-8620-237566b12311`. The backend recorded **ACCEPTED_INDEPENDENTLY_CORRECT**, verified=true, active=false, executionUncertain=false and complete usage.

Reported actual inference: three Nebius Token Factory calls to `nvidia/nemotron-3-super-120b-a12b`; estimated inference $0.015864. Reported actual execution: 14 isolated Nebius Sandbox operations. Native Mocha: 29/29; native browser: 1173/1184 with 11 original skips; types: 17 passes / two pending with core and compat compilation passing; public: 3/3; independent: 10/10. These are the backend's recorded audit results, not a separate raw-receipt replay by this client.

Tested patch SHA-256: `8f6201d813e4996e94c91a05fca4b18537d46d7419d9b5266a044e30f5413603`.

Fresh hosted browser contexts verified unauthenticated 401, supplied judge login, saved-result/patch inspection, patch download identity and 1440/390/320-pixel layouts, with no browser page errors or forbidden requests. The first source-client observer stopped after the start while the backend continued; no repair was retried. A later read-only observation confirmed terminal correctness and a new admitted readiness. Both failed observations are retained privately. A transient uncertainty flag while an active execution guard existed was not a terminal provider failure.

The tested successful-path source client was a V6 candidate. Final source changes strengthen error/uncertainty/launcher handling; the same unchanged frontend and successful relay path are used in the final source package. Production backend code and state were not changed by this release.

The final exact source package then passed a fresh read-only browser rehearsal through its local client: the same new run rendered, both UI assets matched the hosted asset SHA-256 values, patch inspection/download matched the digest above, and all three widths passed with zero page errors, denied requests, or read-observation errors. This follow-up started no repair.

The VM was running as a standard instance with automatic restart enabled and no termination schedule shown. Future hosting/funding and credential retention through the judging period remain owner commitments; no point-in-time check guarantees future uptime.

Inference provenance: three new actual Nebius calls for the single authorized repair; two Claude static-review inferences; fixture/build/source work has zero inference. Execution provenance: local build/controller fixtures and browser transport, with 14 new candidate/original/observer operations confined to Nebius Sandbox. No Devpost submission or video publication is part of this release.
