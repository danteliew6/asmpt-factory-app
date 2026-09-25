"""ASMPT Intelligent Factory — FastAPI backend.

Serves:
  - /api/kpis, /api/watchlist, /api/fpy-by-tool-type  (Command view)
  - /api/features, /api/score                          (Failure-risk simulator)
  - the built React SPA (frontend/dist) for everything else
"""
import logging
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from server import data, model, governance

log = logging.getLogger("asmpt")
logging.basicConfig(level=logging.INFO)

FRONTEND_DIST = Path(__file__).parent / "frontend" / "dist"


@asynccontextmanager
async def lifespan(app: FastAPI):
    try:
        model.load_model()
        log.info("Model loaded. Features: %s", model.feature_order())
    except Exception as e:  # keep app up even if model volume is unreachable
        log.exception("Model load failed: %s", e)
    yield


app = FastAPI(title="ASMPT Intelligent Factory", lifespan=lifespan)


# ---- Command view -------------------------------------------------------
@app.get("/api/kpis")
def kpis():
    try:
        return data.get_kpis()
    except Exception as e:
        log.exception("kpis failed")
        raise HTTPException(status_code=502, detail=str(e))


@app.get("/api/watchlist")
def watchlist(limit: int = 12):
    try:
        return data.get_watchlist(limit)
    except Exception as e:
        log.exception("watchlist failed")
        raise HTTPException(status_code=502, detail=str(e))


@app.get("/api/fpy-by-tool-type")
def fpy_by_tool_type():
    try:
        return data.get_fpy_by_tool_type()
    except Exception as e:
        log.exception("fpy failed")
        raise HTTPException(status_code=502, detail=str(e))


# ---- Failure-risk simulator --------------------------------------------
FEATURE_META = [
    {"key": "avg_health_index", "label": "Avg health index", "min": 0, "max": 100, "step": 1, "unit": ""},
    {"key": "min_health_index", "label": "Min health index", "min": 0, "max": 100, "step": 1, "unit": ""},
    {"key": "avg_vibration", "label": "Avg vibration", "min": 0.5, "max": 4.0, "step": 0.1, "unit": "mm/s"},
    {"key": "avg_placement_um", "label": "Avg placement offset", "min": 5, "max": 60, "step": 1, "unit": "µm"},
    {"key": "avg_coplanarity", "label": "Avg coplanarity", "min": 3, "max": 40, "step": 1, "unit": "µm"},
    {"key": "avg_motor_current", "label": "Avg motor current", "min": 2.0, "max": 9.0, "step": 0.1, "unit": "A"},
    {"key": "avg_cycle_time_ms", "label": "Avg cycle time", "min": 300, "max": 1200, "step": 10, "unit": "ms"},
    {"key": "age_days_at_date", "label": "Tool age", "min": 0, "max": 2500, "step": 10, "unit": "days"},
    {"key": "cum_bonds", "label": "Cumulative bonds", "min": 0, "max": 80000000, "step": 500000, "unit": ""},
]

# Pre-fill with a realistic degraded tool so the simulator opens on a
# meaningful (High-risk) prediction.
DEFAULT_TOOL = {
    "avg_health_index": 42,
    "min_health_index": 30,
    "avg_vibration": 3.2,
    "avg_placement_um": 35,
    "avg_coplanarity": 22,
    "avg_motor_current": 6.5,
    "avg_cycle_time_ms": 780,
    "age_days_at_date": 1600,
    "cum_bonds": 42000000,
}


@app.get("/api/features")
def features():
    return {"features": FEATURE_META, "defaults": DEFAULT_TOOL, "model_ready": model.is_ready()}


class ScoreRequest(BaseModel):
    avg_health_index: float
    min_health_index: float
    avg_vibration: float
    avg_placement_um: float
    avg_coplanarity: float
    avg_motor_current: float
    avg_cycle_time_ms: float
    age_days_at_date: float
    cum_bonds: float


@app.post("/api/score")
def score(req: ScoreRequest):
    if not model.is_ready():
        raise HTTPException(status_code=503, detail="Model not loaded")
    try:
        return model.score(req.model_dump())
    except Exception as e:
        log.exception("score failed")
        raise HTTPException(status_code=500, detail=str(e))


# ---- Unity Catalog governance (FGAC live demo) -------------------------
@app.get("/api/governance")
def governance_view(request: Request):
    token = request.headers.get("x-forwarded-access-token")
    email = request.headers.get("x-forwarded-email") or request.headers.get("x-forwarded-user")
    try:
        return governance.governance_contrast(token, email)
    except Exception as e:
        log.exception("governance failed")
        raise HTTPException(status_code=502, detail=str(e))


@app.get("/api/health")
def health():
    return {"status": "ok", "model_ready": model.is_ready()}


# ---- Static SPA ---------------------------------------------------------
if FRONTEND_DIST.exists():
    app.mount("/assets", StaticFiles(directory=FRONTEND_DIST / "assets"), name="assets")

    @app.get("/{full_path:path}")
    def spa(full_path: str):
        if full_path.startswith("api/"):
            return JSONResponse({"detail": "Not found"}, status_code=404)
        candidate = FRONTEND_DIST / full_path
        if full_path and candidate.is_file():
            return FileResponse(candidate)
        return FileResponse(FRONTEND_DIST / "index.html")
