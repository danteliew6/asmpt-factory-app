"""Unity Catalog FGAC demo: contrast what the app service principal sees vs.
what the signed-in viewer (on-behalf-of) sees, against the SAME governed tables.

The row filter `rf_site` on asmpt_silver.bond_events scopes rows by identity;
the column mask `mask_customer` on customer_name hides customer IP unless the
identity is in the `asmpt_ip_privileged` group. Both are enforced in Unity
Catalog — the app cannot bypass them. We only READ; we never alter policy.
"""
from server.config import SILVER
from server.data import run_as

_COUNT = f"SELECT COUNT(*) AS n FROM {SILVER}.bond_events"
_SAMPLE = f"SELECT tool_id, site, customer_name FROM {SILVER}.bond_events ORDER BY tool_id LIMIT 6"
_MASK = f"SELECT tool_id, site, customer_name FROM {SILVER}.dim_tool ORDER BY tool_id LIMIT 8"
_WHOAMI = "SELECT current_user() AS u"


def _identity(user_token):
    try:
        return run_as(_WHOAMI, user_token)[0]["u"]
    except Exception:
        return None


def _side(user_token):
    """Run the governed queries under one identity. Returns count + sample rows,
    or an error flag if the identity can't query (e.g. no user scope)."""
    try:
        identity = _identity(user_token)
        count = int(run_as(_COUNT, user_token)[0]["n"])
        rows = run_as(_SAMPLE, user_token)
        return {
            "available": True,
            "identity": identity,
            "bond_events_count": count,
            "sample": rows,
        }
    except Exception as e:
        return {"available": False, "error": str(e)}


def governance_contrast(viewer_token: str | None, viewer_email: str | None) -> dict:
    sp = _side(None)  # app service principal
    sp["label"] = "App service principal (restricted)"

    if viewer_token:
        viewer = _side(viewer_token)
    else:
        viewer = {"available": False, "error": "No forwarded viewer token (open the app in a browser session)."}
    viewer["label"] = f"You — {viewer_email}" if viewer_email else "You (entitled viewer)"

    # Column mask: dim_tool is not row-filtered, so the SP can read it; customer_name
    # is masked for BOTH identities (neither is in asmpt_ip_privileged).
    try:
        mask_rows = run_as(_MASK, None)
        mask_available = True
    except Exception as e:
        mask_rows, mask_available = [], str(e)

    return {
        "sp": sp,
        "viewer": viewer,
        "mask": {"available": mask_available is True, "rows": mask_rows, "detail": None if mask_available is True else mask_available},
    }
