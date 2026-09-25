"""Unity Catalog FGAC demo: contrast what the app service principal sees vs.
what the signed-in viewer (on-behalf-of) sees, against the SAME governed tables.

The row filter `rf_site` on asmpt_silver.bond_events scopes rows by identity;
the column mask `mask_customer` on customer_name hides customer IP unless the
identity is in the `asmpt_ip_privileged` group. Both are enforced in Unity
Catalog — the app cannot bypass them. We only READ; we never alter policy.
"""
from server.config import SILVER, GOLD
from server.data import run_many

_COUNT = f"SELECT COUNT(*) AS n FROM {SILVER}.bond_events"
# Persona-preview: per-site scope illustrated from the NON-row-filtered gold
# mart (always readable by the app SP). Shows what rows a site operator would be
# scoped to; UC enforces this per-identity on the raw table in production.
_SITE_SCOPE = f"""
    SELECT site,
           CAST(SUM(bonds) AS BIGINT)                     AS bonds,
           ROUND(100.0*(SUM(bonds)-SUM(fails))/SUM(bonds),1) AS fpy
    FROM {GOLD}.site_daily_kpis
    GROUP BY site
    ORDER BY site
"""
_SAMPLE = f"SELECT tool_id, site, customer_name FROM {SILVER}.bond_events ORDER BY tool_id LIMIT 6"
_MASK = f"SELECT tool_id, site, customer_name FROM {SILVER}.dim_tool ORDER BY tool_id LIMIT 8"
_WHOAMI = "SELECT current_user() AS u"


def _side(user_token, extra=None):
    """Run the governed queries under one identity on a single session. Returns
    count + sample rows (+ any `extra` query results), or an error flag if the
    identity can't query (e.g. no user scope / OBO sign-in required)."""
    queries = [_WHOAMI, _COUNT, _SAMPLE] + (extra or [])
    try:
        res = run_many(queries, user_token)
        out = {
            "available": True,
            "identity": res[0][0]["u"],
            "bond_events_count": int(res[1][0]["n"]),
            "sample": res[2],
        }
        return out, res[3:]
    except Exception as e:
        return {"available": False, "error": str(e)}, []


def governance_contrast(viewer_token: str | None, viewer_email: str | None) -> dict:
    # App service principal side, plus the mask + site-scope queries on the same
    # session (SP can read dim_tool and the gold mart).
    sp, extra = _side(None, extra=[_MASK, _SITE_SCOPE])
    sp["label"] = "App service principal (restricted)"

    if viewer_token:
        viewer, _ = _side(viewer_token)
    else:
        viewer = {"available": False, "error": "No forwarded viewer token (open the app in a browser session)."}
    viewer["label"] = f"You — {viewer_email}" if viewer_email else "You (entitled viewer)"

    # Column mask (dim_tool) — masked for BOTH identities (neither is in asmpt_ip_privileged).
    if len(extra) >= 1:
        mask_rows, mask_available = extra[0], True
    else:
        mask_rows, mask_available = [], "service principal could not read dim_tool"

    # Persona preview: per-site scope from the gold mart (reliable, always-on).
    site_rows = extra[1] if len(extra) >= 2 else []
    for r in site_rows:
        r["bonds"] = int(r["bonds"]) if r["bonds"] is not None else 0
        r["fpy"] = float(r["fpy"]) if r["fpy"] is not None else None
    total = sum(r["bonds"] for r in site_rows)

    return {
        "sp": sp,
        "viewer": viewer,
        "mask": {"available": mask_available is True, "rows": mask_rows, "detail": None if mask_available is True else mask_available},
        "site_scope": {"total_bonds": total, "sites": site_rows},
    }
