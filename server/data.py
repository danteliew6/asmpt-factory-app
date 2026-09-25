"""SQL warehouse data access for the Command view.

All queries read non-row-filtered gold tables, so they run as the app service
principal (which holds SELECT on asmpt_gold). The row filter (rf_site) and
column mask stay live on asmpt_silver.bond_events / the metric view / Genie —
we simply source the app's KPI tiles from the plain gold marts instead.
"""
from databricks import sql
from server.config import get_config, WAREHOUSE_ID, GOLD


def _connect(user_token: str | None = None):
    http_path = f"/sql/1.0/warehouses/{WAREHOUSE_ID}"
    if user_token:
        # On-behalf-of: run as the signed-in viewer (needs the app's `sql` user scope).
        host = get_config().host.replace("https://", "").replace("http://", "")
        return sql.connect(server_hostname=host, http_path=http_path, access_token=user_token)
    cfg = get_config()
    return sql.connect(
        server_hostname=cfg.host.replace("https://", "").replace("http://", ""),
        http_path=http_path,
        credentials_provider=lambda: cfg.authenticate,
    )


def _run(query: str, user_token: str | None = None):
    with _connect(user_token) as conn:
        with conn.cursor() as cur:
            cur.execute(query)
            cols = [c[0] for c in cur.description]
            return [dict(zip(cols, r)) for r in cur.fetchall()]


def run_as(query: str, user_token: str | None = None):
    """Public runner: pass a viewer token to query on-behalf-of the viewer,
    or None to query as the app service principal. Used by the governance view
    to contrast the two identities against Unity Catalog FGAC."""
    return _run(query, user_token)


def get_kpis() -> dict:
    """Overall first-pass yield %, total scrap $, and High-risk tool count.

    Yield/scrap come from the non-row-filtered gold mart site_daily_kpis; the
    High-risk count comes from pm_predictions.
    """
    row = _run(
        f"""
        SELECT 100.0 * (SUM(bonds) - SUM(fails)) / SUM(bonds) AS fpy,
               SUM(scrap_cost_usd)                            AS scrap
        FROM {GOLD}.site_daily_kpis
        """
    )[0]
    risk = _run(
        f"""
        SELECT risk_band, COUNT(*) AS n
        FROM {GOLD}.pm_predictions
        GROUP BY risk_band
        """
    )
    bands = {r["risk_band"]: int(r["n"]) for r in risk}
    return {
        "first_pass_yield_pct": float(row["fpy"]) if row["fpy"] is not None else None,
        "scrap_cost_usd": float(row["scrap"]) if row["scrap"] is not None else None,
        "high_risk_tools": bands.get("High", 0),
        "medium_risk_tools": bands.get("Medium", 0),
        "low_risk_tools": bands.get("Low", 0),
        "total_tools": sum(bands.values()),
        "yield_available": row["fpy"] is not None,
    }


def get_watchlist(limit: int = 12) -> list:
    """Top tools by failure_risk_7d (the predictive-maintenance watchlist)."""
    rows = _run(
        f"""
        SELECT tool_id, site, tool_type,
               ROUND(avg_health_index, 1)  AS health_index,
               CAST(rul_days AS INT)        AS rul_days,
               ROUND(failure_risk_7d, 4)    AS failure_risk_7d,
               risk_band,
               CAST(age_days_at_date AS INT) AS age_days,
               CAST(cum_bonds AS BIGINT)     AS cum_bonds
        FROM {GOLD}.pm_predictions
        ORDER BY failure_risk_7d DESC, avg_health_index ASC
        LIMIT {int(limit)}
        """
    )
    for r in rows:
        r["failure_risk_7d"] = float(r["failure_risk_7d"]) if r["failure_risk_7d"] is not None else None
        r["health_index"] = float(r["health_index"]) if r["health_index"] is not None else None
    return rows


def get_fpy_by_tool_type() -> list:
    """First-pass yield % by tool type from the non-row-filtered tool_health_daily
    mart (TCB Bonder is lowest)."""
    rows = _run(
        f"""
        SELECT tool_type,
               100.0 * (SUM(bonds) - SUM(fails)) / SUM(bonds) AS fpy,
               SUM(scrap_cost_usd)                            AS scrap
        FROM {GOLD}.tool_health_daily
        GROUP BY tool_type
        ORDER BY fpy ASC
        """
    )
    for r in rows:
        r["fpy"] = float(r["fpy"]) if r["fpy"] is not None else None
        r["scrap"] = float(r["scrap"]) if r["scrap"] is not None else None
    return rows
