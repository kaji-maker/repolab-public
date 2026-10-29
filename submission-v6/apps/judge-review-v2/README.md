# ReproLab qualified product review V2

Inspect the actual October 25 independently correct repair in the exact frontend that passed automatic browser qualification. This portable build serves its saved record and exact tested patch. It performs no new inference or Sandbox execution. Fresh repair is unavailable.

## Start

Requires Node 24.18+ and a current browser. No npm install, build, .env, keys, account, provider access or paid credits are needed. Keep all extracted files together. Obtain the trusted manifest SHA-256 from the separate release handoff, and trust the server/frontend source independently; a checksum next to an untrusted executable is not publisher authentication.

In the extracted directory run:

```sh
node server.mjs TRUSTED_MANIFEST_SHA256
```

Open **http://127.0.0.1:4187**. Append a different local port if needed, e.g. `4188`. Stop with Ctrl+C. Opening the HTML with a file URL is unsupported. Keep new files/logs outside the extracted directory: startup rejects extra files, modified files and symlinks. The server binds only localhost, refuses mutations, uses verified in-memory response bytes, writes no state and makes no outbound requests or child processes.

## Reviewer path

1. Read **Saved run**: independently correct, one actual recorded model call and 14 recorded Sandbox operations. Native browser 11 original skips and TypeScript two pending cases remain disclosed.
2. Select **Inspect tested patch** and inspect the bounded, scrollable text pane. Select **Download tested patch** and compare its SHA-256 with `cfa54ecee8c1133134b60f50b92ab053b051e13e9a0c928d5181fff5563ba71d`.
3. Review **Candidate history & operation IDs**. These are historical operation identities, not new execution.
4. Open `/data/result.json` for the portable summary of actual browser qualification and `/data/review.json` for the saved API projection. They contain no credentials, raw provider messages, hidden evaluation inputs or private run directory.
5. Restart the server and reload: the same immutable review remains available. **Start fresh repair** stays disabled, including if provider environment variables happen to exist.

## Recorded provenance and limits

Actual run `8e33657a-d655-4d4b-80d3-2a432058ceed`, October 25, 2026: one Nebius Token Factory `nvidia/nemotron-3-super-120b-a12b` request, 14 isolated Nebius Sandbox operations, candidate 1 independently correct. Native: 29 Mocha passes, 1,173 browser passes/11 original skips, core/compat type compilation, 17 passed/two pending. Public 3/3; independent 10/10 repeated after immutable selection. Estimated inference $0.0047514; Sandbox billing unconfirmed. Source SHA-256 `4fd44f4516eadb65efa7dd0227b469a2fe704ea08a650ebe01da9c93cc2e6c47`.

This is one exposed Preact ref-cleanup feature, with developer-supplied ownership scaffolding and a same-project cached image. It does not measure hidden-task accuracy or cross-project portability. The full original raw audit ran in the authoritative checkout before export; this bundle checks immutable export identity, not raw provider receipts online. Original browser V1 retains incomplete automatic observation; V2 does not retroactively qualify it. The eight-task study remains unchanged.

This build preserves the qualified frontend and supplies a new read-only portable server. It does not package or enable the live provider service. Local packaging does not establish public/free judge access, a separate-machine or unaided human review, sponsor-runtime eligibility of a review-only build, or continued availability through judging. Public distribution/source, the complete live-service judge journey and submission remain separate gates. No publication or hosting is performed by starting this server.

ReproLab is MIT licensed. Bundled React/React DOM/Scheduler and the Preact patch retain their license notices. See `THIRD_PARTY_NOTICES.md` and the accompanying license files. Candidate/original/observer source is never executed; the patch is text only.

Current review inference: **none**. Execution: **local static product/evidence review only**, with historical actual results labeled above and in the interface.
