import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import "./fresh-preact.css";
import "./fresh-preact-v8.css";
import { nativeReviewDisposition } from "../../../packages/repositories/native-review-display-v2.ts";
import { browserPollState } from "../../../packages/repositories/preact-browser-poll-v1.ts";

type Repair = {
  id: string; status: string; verified: boolean; simulated: boolean; active: boolean;
  accepted: boolean; startedAt: string; error: string | null; executionUncertain: boolean;
  inferenceCalls: number; executionCount: number; estimatedInferenceUsd: number; usageComplete: boolean;
  sourceHash: string | null; patchSha256: string | null; patchAvailable: boolean;
  provenance: { inference: string; execution: string; model: string };
  native: { mocha: { passed: number; total: number }; browser: { passed: number; total: number; skipped: number }; types: unknown } | null;
  public: { passed: number; total: number } | null;
  independent: { passed: number; total: number; failed: string[] } | null;
  candidates: { attempt: number; status: string; stages: string[] }[];
  operationIds: string[]; scope: string;
};
type Catalog = { readiness: { available: boolean; reason: string }; history: Repair[] };
const path = "/api/native-preact-repairs-v4";
async function request<T>(route: string, body?: unknown): Promise<T> {
  const response = await fetch(path + route, { cache: "no-store", ...(body === undefined ? {} : {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  }) });
  const data = await response.json();
  if (!response.ok) throw Error(data.error ?? "Request failed");
  return data;
}
function FreshPreactV9() {
  const [catalog, setCatalog] = useState<Catalog | null>(null), [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null), [pending, setPending] = useState(false);
  const [patch, setPatch] = useState<{ id: string; text: string } | null>(null), [inspecting, setInspecting] = useState(false);
  const refresh = useRef<() => Promise<void>>(async () => {}), isActive = useRef(false);
  const awaiting = useRef<string | null>(null);
  useEffect(() => {
    let disposed = false, loading = false;
    refresh.current = async () => {
      if (loading || disposed) return;
      loading = true;
      try {
        const data = await request<Catalog>("");
        if (!disposed) {
          setCatalog(data);
          const poll = browserPollState(data.history, awaiting.current);
          awaiting.current = poll.awaiting; isActive.current = poll.shouldPoll;
          setSelected(current => current ?? data.history[0]?.id ?? null); setError(null);
        }
      } catch (e) { if (!disposed) setError(e instanceof Error ? e.message : "Saved evidence unavailable"); }
      finally { loading = false; }
    };
    void refresh.current();
    const timer = setInterval(() => { if (isActive.current) void refresh.current(); }, 5000);
    return () => { disposed = true; clearInterval(timer); };
  }, []);
  const repair = catalog?.history.find(r => r.id === selected) ?? null;
  const disposition = repair ? nativeReviewDisposition(repair) : null;
  const proof = !!repair?.patchAvailable && !!disposition?.proofBadgeAllowed && !repair?.executionUncertain && !!repair?.usageComplete;
  async function start() {
    setPending(true); setError(null); setPatch(null);
    try { const value = await request<{ id: string }>("", {}); awaiting.current = value.id; setSelected(value.id); isActive.current = true; await refresh.current(); }
    catch (e) { setError(e instanceof Error ? e.message : "Repair could not start"); }
    finally { setPending(false); }
  }
  async function cancel() {
    if (!repair) return;
    setPending(true);
    try { await request("/" + repair.id + "/cancel", {}); await refresh.current(); }
    catch (e) { setError(e instanceof Error ? e.message : "Cancellation unavailable"); }
    finally { setPending(false); }
  }
  async function inspect() {
    if (!repair || !proof) return;
    const id = repair.id; setInspecting(true); setError(null);
    try {
      const response = await fetch(path + "/" + id + "/patch", { cache: "no-store" });
      if (!response.ok) throw Error("Audited patch unavailable");
      setPatch({ id, text: await response.text() });
    } catch (e) { setError(e instanceof Error ? e.message : "Patch unavailable"); }
    finally { setInspecting(false); }
  }
  return <main className="fresh-shell">
    <header><a className="fresh-brand" href="/">ReproLab <span>Native repair · V4</span></a><span className="fresh-muted">Review saved evidence without provider calls</span></header>
    <div className="fresh-heading"><p className="fresh-eyebrow">PREACT · REF CLEANUP · ORIGINAL NATIVE TESTS</p>
      <h1>A tested repair you can inspect.</h1><p>Review the candidate selected by public and native checks, its independent evaluation, and the exact patch produced by Nebius and NVIDIA Nemotron.</p></div>
    {error && <div role="alert" className="fresh-alert">{error}</div>}
    <div className="fresh-grid">
      <section className="fresh-card" aria-labelledby="run-heading"><h2 id="run-heading">Run a scoped repair</h2>
        <p className="fresh-muted">Nebius Token Factory generates up to three candidates. Isolated Sandbox checks test the selected source before independent evaluation.</p>
        <dl className="fresh-profile"><dt>Inference</dt><dd>NVIDIA Nemotron</dd><dt>Execution</dt><dd>Nebius Sandbox</dd><dt>Bounds</dt><dd>3 model calls · 34 operations</dd></dl>
        <button className="fresh-primary" disabled={pending || !catalog?.readiness.available} onClick={() => void start()}>Start fresh repair</button>
        <p className="fresh-readiness">{catalog?.readiness.reason ?? "Loading saved evidence…"}</p>
        <p className="fresh-note">Completed runs stay available for inspection. Starting another run does not resume a consumed workflow.</p>
      </section>
      <section className="fresh-card" aria-labelledby="evidence-heading"><div className="fresh-card-title"><h2 id="evidence-heading">Saved run</h2>
        {proof && <span className="fresh-verified">Independently verified</span>}</div>
        {!repair ? <p role="status" className="fresh-muted">{awaiting.current ? "Waiting for saved run evidence…" : catalog ? "No saved V4 run is available in this environment." : "Loading saved evidence…"}</p> : <>
          <p className="fresh-status" data-testid="repair-status">{repair.status}</p><p className="fresh-hash">{repair.id}</p>
          <div className="fresh-metrics"><div><b>{repair.inferenceCalls}</b><span>{repair.simulated ? "Fixture model calls" : "Actual model calls"}</span></div><div><b>{repair.executionCount}</b><span>{repair.simulated ? "Fixture operations" : "Sandbox operations"}</span></div><div><b>${repair.estimatedInferenceUsd.toFixed(6)}</b><span>Estimated inference</span></div></div>
          {repair.simulated && <p className="fresh-alert">Fixture run · no candidate source was executed.</p>}
          {repair.error && <p className="fresh-alert">{repair.error}</p>}
          {repair.executionUncertain && <p className="fresh-alert">Execution is unresolved. Further work requires reviewed recovery; evidence and leases are retained.</p>}
          {disposition?.abstentionExplanation && <p className="fresh-alert">{disposition.abstentionExplanation}</p>}
          {!repair.usageComplete && <p className="fresh-alert">Inference accounting is incomplete.</p>}
          {repair.active && <button disabled={pending} onClick={() => void cancel()}>Cancel repair</button>}
          <dl className="fresh-results"><dt>Native Mocha</dt><dd>{repair.native ? `${repair.native.mocha.passed}/${repair.native.mocha.total}` : "Not verified"}</dd>
            <dt>Native browser</dt><dd>{repair.native ? `${repair.native.browser.passed}/${repair.native.browser.total} · ${repair.native.browser.skipped} original skips` : "Not verified"}</dd>
            <dt>Public checks</dt><dd>{repair.public ? `${repair.public.passed}/${repair.public.total}` : "Not evaluated"}</dd>
            <dt>Independent checks</dt><dd>{repair.independent ? `${repair.independent.passed}/${repair.independent.total}` : "Not evaluated"}</dd></dl>
          <p className="fresh-note">Saved inference: {repair.provenance.inference}<br />Saved execution: {repair.provenance.execution}<br />Model: {repair.provenance.model}</p>
          {repair.sourceHash && <p className="fresh-hash">Selected source · {repair.sourceHash}</p>}
          {proof && <><div className="v8-actions"><button disabled={inspecting} onClick={() => void inspect()}>{inspecting ? "Loading patch…" : "Inspect tested patch"}</button>
            <a className="fresh-download" href={`${path}/${repair.id}/patch`}>Download tested patch</a></div>
            <p className="fresh-hash">Patch SHA-256 · {repair.patchSha256}</p></>}
          {proof && patch?.id === repair.id && <section aria-label="Tested patch" className="v8-patch"><h3>Tested patch</h3><pre tabIndex={0}>{patch.text}</pre></section>}
          <details><summary>Candidate history & operation IDs</summary>{repair.candidates.map(c => <p key={c.attempt}>Candidate {c.attempt}: {c.status} · {c.stages.length} stages</p>)}
            <ul>{repair.operationIds.map(id => <li className="fresh-hash" key={id}>{id}</li>)}</ul></details>
        </>}
      </section>
    </div>
    <section className="fresh-card fresh-history"><h2>Run history</h2><button onClick={() => void refresh.current()}>Refresh saved evidence</button>
      <ul>{catalog?.history.map(r => <li key={r.id}><button className={selected === r.id ? "fresh-selected" : ""} aria-pressed={selected === r.id}
        onClick={() => { setSelected(r.id); setPatch(null); }}><span>{new Date(r.startedAt).toLocaleString()}</span><strong>{r.status}</strong><small>{r.inferenceCalls} calls · {r.executionCount} operations · {r.verified ? "audited" : "retained"}</small></button></li>)}</ul>
    </section>
    <footer>One exposed Preact feature with developer-supplied scaffolding and a cached original image. Recorded checks do not measure hidden-task or cross-project accuracy. Viewing this page creates no new inference or Sandbox execution.</footer>
  </main>;
}
createRoot(document.getElementById("root")!).render(<FreshPreactV9 />);
