import { useEffect, useMemo, useState } from "react";

type Kpis = {
  first_pass_yield_pct: number | null;
  scrap_cost_usd: number | null;
  defect_rate_pct: number | null;
  high_risk_tools: number;
  total_tools: number;
  yield_available: boolean;
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
          {!kpis ? <div className="value skel" style={{ height: 34, width: 120 }} />
            : kpis.yield_available ? <div className="value">{kpis.first_pass_yield_pct?.toFixed(1)}%</div>
            : <div className="value" style={{ fontSize: 20, color: "var(--ink-3)" }}>Restricted</div>}
          <div className="sub">{kpis && !kpis.yield_available ? "Governed source — sign-in identity not entitled to site data" : "Fleet-wide, all sites · target 95%"}</div>
        </div>
        <div className="kpi warn">
          <div className="label">Scrap cost</div>
          {!kpis ? <div className="value skel" style={{ height: 34, width: 120 }} />
            : kpis.yield_available ? <div className="value warn">{fmtUSD(kpis.scrap_cost_usd)}</div>
            : <div className="value" style={{ fontSize: 20, color: "var(--ink-3)" }}>Restricted</div>}
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
            ) : fpy.length === 0 ? (
              <div className="foot" style={{ padding: "24px 4px" }}>Yield by tool type is governed by site-level access; the current sign-in identity is not entitled to these rows.</div>
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

/* ============================ GOVERNANCE VIEW ============================ */
type GovSide = { available: boolean; identity?: string; bond_events_count?: number; sample?: { tool_id: string; site: string; customer_name: string }[]; error?: string; label: string };
type SiteScope = { site: string; bonds: number; fpy: number | null };
type Gov = {
  sp: GovSide;
  viewer: GovSide;
  mask: { available: boolean; rows: { tool_id: string; site: string; customer_name: string }[]; detail?: string | null };
  site_scope: { total_bonds: number; sites: SiteScope[] };
};

function GovernanceView() {
  const [gov, setGov] = useState<Gov | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [active, setActive] = useState<"sp" | "viewer">("sp");
  const [persona, setPersona] = useState<string>("Global");

  useEffect(() => {
    getJSON<Gov>("/api/governance").then(setGov).catch((e) => setErr(String(e.message || e)));
  }, []);

  const side = gov ? gov[active] : null;
  const sites = gov?.site_scope.sites ?? [];
  const personaBonds = persona === "Global" ? (gov?.site_scope.total_bonds ?? 0) : (sites.find((s) => s.site === persona)?.bonds ?? 0);
  const personaFpy = persona === "Global"
    ? null
    : sites.find((s) => s.site === persona)?.fpy ?? null;

  return (
    <>
      <div className="view-head">
        <h1>Unity Catalog Governance — fine-grained access control, live</h1>
        <p>The same governed tables, seen through two identities. Row-level and column-level policies are enforced by Unity Catalog; the app cannot bypass them.</p>
      </div>

      <div className="gov-banner">
        <b>How this is enforced</b>
        Row filter <code>rf_site</code> scopes rows by the signed-in identity; column mask <code>mask_customer</code> hides customer IP unless the identity is in the <code>asmpt_ip_privileged</code> group. Both are enforced in Unity Catalog — the app cannot see past them.
      </div>

      {err && <div className="err">Could not load governance data: {err}</div>}

      {/* View-as toggle */}
      <div className="toggle-row">
        <span className="toggle-label">View as</span>
        <div className="seg">
          <button className={`seg-btn ${active === "sp" ? "on" : ""}`} onClick={() => setActive("sp")}>App service principal <em>(restricted)</em></button>
          <button className={`seg-btn ${active === "viewer" ? "on" : ""}`} onClick={() => setActive("viewer")}>You <em>(entitled viewer)</em></button>
        </div>
      </div>

      {/* Row-filter contrast: both counts side by side */}
      <div className="kpi-row" style={{ gridTemplateColumns: "1fr 1fr" }}>
        <GovCount side={gov?.sp} active={active === "sp"} onClick={() => setActive("sp")} />
        <GovCount side={gov?.viewer} active={active === "viewer"} onClick={() => setActive("viewer")} />
      </div>

      <div className="grid" style={{ gridTemplateColumns: "1fr 1fr" }}>
        {/* Selected identity's bond_events sample (row filter) */}
        <div className="card">
          <div className="card-head">
            <h2>Rows visible to: {side?.label ?? "…"}</h2>
            <p className="msg">Row filter <code>rf_site</code> on <code>asmpt_silver.bond_events</code>. Identity: <span className="mono">{side?.identity || "—"}</span></p>
          </div>
          <div className="card-body" style={{ paddingTop: 4 }}>
            {!gov ? <div className="skel" style={{ height: 200 }} />
              : !side?.available ? (
                <div className="empty-rows">
                  <div style={{ fontWeight: 700, color: "var(--ink-2)", marginBottom: 4 }}>On-behalf-of sign-in required</div>
                  Open the app in a signed-in browser session to run as yourself. The app forwards your token (scope <code>sql</code>) and Unity Catalog scopes rows to <b>your</b> entitlements — an admin / whitelisted user sees all sites.
                </div>
              )
              : (side.sample && side.sample.length > 0) ? (
                <table>
                  <thead><tr><th>Tool</th><th>Site</th><th>Customer name</th></tr></thead>
                  <tbody>{side.sample.map((r, i) => (
                    <tr key={i}><td className="mono">{r.tool_id}</td><td>{r.site}</td><td className="masked">{r.customer_name}</td></tr>
                  ))}</tbody>
                </table>
              ) : (
                <div className="empty-rows">
                  <div className="big-zero">0 rows</div>
                  No site entitlement — <code>rf_site</code> returns nothing for this identity.
                </div>
              )}
          </div>
        </div>

        {/* Column mask (active under both identities) */}
        <div className="card">
          <div className="card-head">
            <h2>Column mask — always active</h2>
            <p className="msg">Mask <code>mask_customer</code> on <code>asmpt_silver.dim_tool</code>. Masked for <b>both</b> identities (neither is in <code>asmpt_ip_privileged</code>).</p>
          </div>
          <div className="card-body" style={{ paddingTop: 4 }}>
            {!gov ? <div className="skel" style={{ height: 200 }} />
              : gov.mask.available ? (
                <table>
                  <thead><tr><th>Tool</th><th>Site</th><th>Customer name</th></tr></thead>
                  <tbody>{gov.mask.rows.map((r, i) => (
                    <tr key={i}><td className="mono">{r.tool_id}</td><td>{r.site}</td><td className="masked">{r.customer_name}</td></tr>
                  ))}</tbody>
                </table>
              ) : <div className="foot">{gov.mask.detail}</div>}
          </div>
        </div>
      </div>
      {/* Persona preview — reliable per-site scoping from governed gold aggregates */}
      <div className="card" style={{ marginTop: 16 }}>
        <div className="card-head">
          <h2>Per-site scope — persona preview</h2>
          <p className="msg">Illustrates the row scope <code>rf_site</code> grants a site operator. Sourced from governed gold aggregates; UC enforces the same scope per-identity on the raw table in production.</p>
        </div>
        <div className="card-body">
          <div className="toggle-row" style={{ marginBottom: 14 }}>
            <span className="toggle-label">Persona</span>
            <div className="seg">
              {["Global", ...sites.map((s) => s.site)].map((s) => (
                <button key={s} className={`seg-btn ${persona === s ? "on" : ""}`} onClick={() => setPersona(s)}>{s}</button>
              ))}
            </div>
          </div>
          <div style={{ display: "flex", gap: 28, alignItems: "baseline", flexWrap: "wrap" }}>
            <div>
              <div className="label" style={{ fontSize: 12, textTransform: "uppercase", letterSpacing: ".8px", color: "var(--ink-3)", fontWeight: 700 }}>Bonds in scope</div>
              <div style={{ fontSize: 30, fontWeight: 800 }}>{gov ? personaBonds.toLocaleString() : "—"}</div>
            </div>
            {personaFpy != null && (
              <div>
                <div className="label" style={{ fontSize: 12, textTransform: "uppercase", letterSpacing: ".8px", color: "var(--ink-3)", fontWeight: 700 }}>First-pass yield</div>
                <div style={{ fontSize: 30, fontWeight: 800 }}>{personaFpy.toFixed(1)}%</div>
              </div>
            )}
            <div className="foot" style={{ maxWidth: 380 }}>
              {persona === "Global"
                ? "A user in `admins` (or the app owner) sees every site."
                : `A member of asmpt_${persona.toLowerCase().replace(/[^a-z]/g, "")} is scoped to ${persona} only.`}
            </div>
          </div>
        </div>
      </div>

      <div className="source">Live queries against Unity Catalog. Service principal = <span className="mono">{gov?.sp.identity || "app SP"}</span>; entitled viewer via on-behalf-of user auth.</div>
    </>
  );
}

function GovCount({ side, active, onClick }: { side?: GovSide; active: boolean; onClick: () => void }) {
  const restricted = side && side.available && (side.bond_events_count ?? 0) === 0;
  return (
    <div className={`kpi gov-count ${active ? "sel" : ""} ${restricted ? "warn" : ""}`} onClick={onClick} style={{ cursor: "pointer" }}>
      <div className="label">{side?.label ?? "…"}</div>
      {!side ? <div className="value skel" style={{ height: 34, width: 120 }} />
        : !side.available ? <div className="value" style={{ fontSize: 18, color: "var(--ink-3)" }}>No SQL access</div>
        : <div className={`value ${restricted ? "warn" : ""}`}>{(side.bond_events_count ?? 0).toLocaleString()}</div>}
      <div className="sub">rows of <code>bond_events</code> visible · via <code>rf_site</code></div>
    </div>
  );
}

/* ============================ SHELL ============================ */
export default function App() {
  const [tab, setTab] = useState<"command" | "sim" | "gov">("command");
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
          <button className={`tab ${tab === "gov" ? "active" : ""}`} onClick={() => setTab("gov")}>Unity Catalog governance</button>
        </div>
        <div className="spacer" />
        <div className="env-pill">dante_classic_stable_catalog · asmpt_gold</div>
      </div>
      <div className="main">
        {tab === "command" ? <CommandView /> : tab === "sim" ? <SimulatorView /> : <GovernanceView />}
      </div>
    </div>
  );
}
