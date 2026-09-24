"""SQL warehouse data access for the Command view."""
from functools import lru_cache
from databricks import sql
from server.config import get_config, WAREHOUSE_ID, GOLD


def _connect():
    cfg = get_config()
    return sql.connect(
        server_hostname=cfg.host.replace("https://", "").replace("http://", ""),
        http_path=f"/sql/1.0/warehouses/{WAREHOUSE_ID}",
        credentials_provider=lambda: cfg.authenticate,
    )


def _run(query: str):
    with _connect() as conn:
        with conn.cursor() as cur:
            cur.execute(query)
            cols = [c[0] for c in cur.description]
            return [dict(zip(cols, r)) for r in cur.fetchall()]


def get_kpis() -> dict:
    """Overall first-pass yield %, total scrap $, and High-risk tool count."""
    row = _run(
        f"""
        SELECT MEASURE(`First Pass Yield Pct`) AS fpy,
               MEASURE(`Scrap Cost USD`)       AS scrap,
               MEASURE(`Defect Rate Pct`)      AS defect
        FROM {GOLD}.mv_manufacturing_kpis
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
        "defect_rate_pct": float(row["defect"]) if row["defect"] is not None else None,
        "high_risk_tools": bands.get("High", 0),
        "medium_risk_tools": bands.get("Medium", 0),
        "low_risk_tools": bands.get("Low", 0),
        "total_tools": sum(bands.values()),
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
    """First-pass yield % by tool type (TCB should be lowest)."""
    rows = _run(
        f"""
        SELECT `Tool Type` AS tool_type,
               MEASURE(`First Pass Yield Pct`) AS fpy,
               MEASURE(`Scrap Cost USD`)       AS scrap
        FROM {GOLD}.mv_manufacturing_kpis
        GROUP BY ALL
        ORDER BY fpy ASC
        """
    )
    for r in rows:
        r["fpy"] = float(r["fpy"]) if r["fpy"] is not None else None
        r["scrap"] = float(r["scrap"]) if r["scrap"] is not None else None
    return rows
