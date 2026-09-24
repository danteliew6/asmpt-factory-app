import { useEffect, useMemo, useState } from "react";

type Kpis = {
  first_pass_yield_pct: number | null;
  scrap_cost_usd: number | null;
  defect_rate_pct: number | null;
  high_risk_tools: number;
  total_tools: number;
};
type WatchRow = {
  tool_id: string; site: string; tool_type: string;
  health_index: number | null; rul_days: number | null;
  failure_risk_7d: number | null; risk_band: "High" | "Medium" | "Low";
};
type FpyRow = { tool_type: string; fpy: number | null; scrap: number | null };
type FeatureMeta = { key: string; label: string; min: number; max: number; step: number; unit: string };
type ScoreResult = { failure_risk_pct: number; risk_band: "High" | "Medium" | "Low"; recommendation: string };

const riskColor: Record<string, string> = { High: "var(--high)", Medium: "var(--med)", Low: "var(--low)" };

async function getJSON<T>(url: string): Promise<T> {
  const r = await fetch(url);
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).detail || `HTTP ${r.status}`);
  return r.json();
}

function fmtUSD(v: number | null): string {
  if (v == null) return "—";
  if (v >= 1e6) return `$${(v / 1e6).toFixed(1)}M`;
  if (v >= 1e3) return `$${(v / 1e3).toFixed(0)}K`;
  return `$${v.toFixed(0)}`;
}

/* ============================ COMMAND VIEW ============================ */
function CommandView() {
  const [kpis, setKpis] = useState<Kpis | null>(null);
  const [watch, setWatch] = useState<WatchRow[] | null>(null);
  const [fpy, setFpy] = useState<FpyRow[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      getJSON<Kpis>("/api/kpis"),
      getJSON<WatchRow[]>("/api/watchlist?limit=12"),
      getJSON<FpyRow[]>("/api/fpy-by-tool-type"),
    ]).then(([k, w, f]) => { setKpis(k); setWatch(w); setFpy(f); })
      .catch((e) => setErr(String(e.message || e)));
  }, []);

  const maxFpy = useMemo(() => Math.max(100, ...(fpy || []).map((r) => r.fpy || 0)), [fpy]);

  return (
    <>
      <div className="view-head">
        <h1>Factory Command — production risk & yield at a glance</h1>
        <p>Predictive-maintenance and yield signals across the tool fleet, refreshed from the gold layer.</p>
      </div>

      {err && <div className="err">Could not load data: {err}</div>}

      {/* KPI tiles */}
      <div className="kpi-row">
        <div className="kpi">
          <div className="label">First-pass yield</div>
          {kpis ? <div className="value">{kpis.first_pass_yield_pct?.toFixed(1)}%</div> : <div className="value skel" style={{ height: 34, width: 120 }} />}
          <div className="sub">Fleet-wide, all sites · target 95%</div>
        </div>
        <div className="kpi warn">
          <div className="label">Scrap cost</div>
          {kpis ? <div className="value warn">{fmtUSD(kpis.scrap_cost_usd)}</div> : <div className="value skel" style={{ height: 34, width: 120 }} />}
          <div className="sub">Cumulative cost of scrapped output</div>
        </div>
        <div className="kpi warn">
          <div className="label">Tools at high failure risk</div>
          {kpis ? <div className="value warn">{kpis.high_risk_tools}</div> : <div className="value skel" style={{ height: 34, width: 80 }} />}
          <div className="sub">of {kpis?.total_tools ?? "—"} tools · 7-day predicted failure</div>
        </div>
      </div>

      <div className="grid">
        {/* Watchlist */}
        <div className="card">
          <div className="card-head">
            <h2>Predictive-maintenance watchlist</h2>
            <p className="msg">Highest 7-day failure risk first — service these before they take down uptime.</p>
          </div>
          <div className="card-body" style={{ paddingTop: 4 }}>
            {err ? null : !watch ? (
              <div className="skel" style={{ height: 260 }} />
            ) : watch.length === 0 ? (
              <div className="foot">No tools scored yet.</div>
            ) : (
              <table>
                <thead>
                  <tr>
                    <th>Tool</th><th>Site</th><th>Type</th>
                    <th className="num">Health</th><th className="num">RUL (d)</th>
                    <th>Failure risk (7d)</th><th>Band</th>
                  </tr>
                </thead>
                <tbody>
                  {watch.map((r) => (
                    <tr key={r.tool_id}>
                      <td className="mono">{r.tool_id}</td>
                      <td>{r.site}</td>
                      <td>{r.tool_type}</td>
                      <td className="num">{r.health_index?.toFixed(0)}</td>
                      <td className="num">{r.rul_days}</td>
                      <td>
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <div className="riskbar"><i style={{ width: `${(r.failure_risk_7d || 0) * 100}%`, background: riskColor[r.risk_band] }} /></div>
                          <span style={{ fontVariantNumeric: "tabular-nums", fontWeight: 700, minWidth: 34 }}>
                            {((r.failure_risk_7d || 0) * 100).toFixed(0)}%
                          </span>
                        </div>
                      </td>
                      <td><span className={`pill ${r.risk_band}`}>{r.risk_band}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <div className="source">Source: asmpt_gold.pm_predictions (model-scored) · one row per tool</div>
          </div>
        </div>

        {/* FPY by tool type */}
        <div className="card">
          <div className="card-head">
            <h2>First-pass yield by tool type</h2>
            <p className="msg">TCB Bonder is the yield laggard — the biggest scrap-reduction opportunity.</p>
          </div>
          <div className="card-body">
            {err ? null : !fpy ? (
              <div className="skel" style={{ height: 220 }} />
            ) : (
              <div className="bars">
                {fpy.map((r, i) => (
                  <div className="bar-row" key={r.tool_type}>
                    <div className="name">{r.tool_type}</div>
                    <div className="bar-track">
                      <div className={`bar-fill${i === 0 ? " laggard" : ""}`} style={{ width: `${((r.fpy || 0) / maxFpy) * 100}%` }} />
                      <div className="bench" style={{ left: `${(95 / maxFpy) * 100}%` }} title="Target 95%" />
                    </div>
                    <div className="pct">{r.fpy?.toFixed(1)}%</div>
                  </div>
                ))}
              </div>
            )}
            <div className="source">Source: asmpt_gold.mv_manufacturing_kpis · MEASURE(First Pass Yield Pct) · vertical line = 95% target</div>
          </div>
        </div>
      </div>
    </>
  );
}

/* ============================ SIMULATOR VIEW ============================ */
function SimulatorView() {
  const [meta, setMeta] = useState<FeatureMeta[] | null>(null);
  const [vals, setVals] = useState<Record<string, number>>({});
  const [result, setResult] = useState<ScoreResult | null>(null);
  const [scoring, setScoring] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    getJSON<{ features: FeatureMeta[]; defaults: Record<string, number> }>("/api/features")
      .then((d) => { setMeta(d.features); setVals(d.defaults); return scoreWith(d.defaults); })
      .catch((e) => setErr(String(e.message || e)));
  }, []);

  async function scoreWith(v: Record<string, number>) {
    setScoring(true); setErr(null);
    try { setResult(await postJSON<ScoreResult>("/api/score", v)); }
    catch (e: any) { setErr(String(e.message || e)); }
    finally { setScoring(false); }
  }

  function set(key: string, v: number) { setVals((p) => ({ ...p, [key]: v })); }

  return (
    <>
      <div className="view-head">
        <h1>Failure-risk simulator — live Service 4.0 scoring</h1>
        <p>Adjust a tool's sensor and usage signals; the model returns its 7-day failure probability and a service recommendation.</p>
      </div>

      <div className="sim-grid">
        <div className="card">
          <div className="card-head">
            <h2>Tool signals</h2>
            <p className="msg">Pre-filled with a degraded production tool. Drag any signal to explore.</p>
          </div>
          <div className="card-body">
            {!meta ? (
              <div className="skel" style={{ height: 320 }} />
            ) : (
              <>
                <div className="sliders">
                  {meta.map((f) => (
                    <div className="field" key={f.key}>
                      <label>
                        <span>{f.label}{f.unit ? ` (${f.unit})` : ""}</span>
                        <b>{f.key === "cum_bonds" ? `${((vals[f.key] || 0) / 1e6).toFixed(1)}M` : (vals[f.key] ?? 0)}</b>
                      </label>
                      <input type="range" min={f.min} max={f.max} step={f.step}
                        value={vals[f.key] ?? f.min}
                        onChange={(e) => set(f.key, Number(e.target.value))} />
                      <div className="rng"><span>{f.min}</span><span>{f.max}</span></div>
                    </div>
                  ))}
                </div>
                <div className="sim-actions">
                  <button className="btn primary" disabled={scoring} onClick={() => scoreWith(vals)}>
                    {scoring ? "Scoring…" : "Score failure risk"}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>

        <div className="card">
          <div className="card-head">
            <h2>Model prediction</h2>
            <p className="msg">7-day failure probability · HistGradientBoosting model</p>
          </div>
          <div className="card-body">
            {err && <div className="err">{err}</div>}
            {!result && !err && <div className="skel" style={{ height: 240 }} />}
            {result && (
              <div className="result">
                <Gauge pct={result.failure_risk_pct} band={result.risk_band} />
                <span className={`pill ${result.risk_band}`} style={{ fontSize: 13 }}>{result.risk_band} risk</span>
                <div className={`reco ${result.risk_band}`}>
                  <b>Recommended action</b>
                  {result.recommendation}
                </div>
              </div>
            )}
            <div className="source">Live scoring via asmpt_gold/models/pm_model.pkl (predict_proba)</div>
          </div>
        </div>
      </div>
    </>
  );
}

function Gauge({ pct, band }: { pct: number; band: string }) {
  const r = 78, c = 2 * Math.PI * r, off = c * (1 - pct / 100);
  return (
    <div className="gauge">
      <svg width="180" height="180" viewBox="0 0 180 180">
        <circle cx="90" cy="90" r={r} fill="none" stroke="#eef2f6" strokeWidth="14" />
        <circle cx="90" cy="90" r={r} fill="none" stroke={riskColor[band]} strokeWidth="14"
          strokeLinecap="round" strokeDasharray={c} strokeDashoffset={off}
          transform="rotate(-90 90 90)" style={{ transition: "stroke-dashoffset .6s ease" }} />
        <text x="90" y="86" textAnchor="middle" className="big" fill="var(--ink)"
          style={{ font: "800 40px Inter, sans-serif" }}>{pct.toFixed(0)}%</text>
        <text x="90" y="108" textAnchor="middle" fill="var(--ink-3)"
          style={{ font: "700 11px Inter, sans-serif", letterSpacing: "1px" }}>FAILURE RISK</text>
      </svg>
    </div>
  );
}

async function postJSON<T>(url: string, body: unknown): Promise<T> {
  const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).detail || `HTTP ${r.status}`);
  return r.json();
}

/* ============================ SHELL ============================ */
export default function App() {
  const [tab, setTab] = useState<"command" | "sim">("command");
  return (
    <div className="shell">
      <div className="topbar">
        <div className="brand">
          <span className="dot" />
          <div>ASMPT Intelligent Factory<small>Service 4.0 · Predictive Maintenance & Yield</small></div>
        </div>
        <div className="tabs">
          <button className={`tab ${tab === "command" ? "active" : ""}`} onClick={() => setTab("command")}>Command</button>
          <button className={`tab ${tab === "sim" ? "active" : ""}`} onClick={() => setTab("sim")}>Failure-risk simulator</button>
        </div>
        <div className="spacer" />
        <div className="env-pill">dante_classic_stable_catalog · asmpt_gold</div>
      </div>
      <div className="main">
        {tab === "command" ? <CommandView /> : <SimulatorView />}
      </div>
    </div>
  );
}
