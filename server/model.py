"""Live failure-risk scoring using the exported scikit-learn model."""
import io
import json
import os
import joblib
import pandas as pd
from server.config import MODEL_DIR, get_config

_model = None
_features = None


def _read_volume_file(path: str) -> bytes:
    """Read a UC Volume file. Databricks Apps do NOT FUSE-mount /Volumes, so
    use the SDK Files API (works with the app SP's READ VOLUME grant). Falls
    back to a local filesystem read for local dev."""
    if os.path.exists(path):
        with open(path, "rb") as f:
            return f.read()
    from databricks.sdk import WorkspaceClient

    w = WorkspaceClient(config=get_config())
    resp = w.files.download(path)
    return resp.contents.read()


def load_model():
    """Load the pickled sklearn model + feature order at startup."""
    global _model, _features
    if _model is not None:
        return
    feats_bytes = _read_volume_file(os.path.join(MODEL_DIR, "pm_features.json"))
    _features = json.loads(feats_bytes.decode("utf-8"))
    model_bytes = _read_volume_file(os.path.join(MODEL_DIR, "pm_model.pkl"))
    _model = joblib.load(io.BytesIO(model_bytes))


def is_ready() -> bool:
    return _model is not None


def feature_order():
    return list(_features) if _features else []


def _band_and_reco(prob: float):
    """Map a failure probability to a risk band + plain-English recommendation."""
    if prob >= 0.5:
        days = max(1, round((1.0 - prob) * 14))
        return (
            "High",
            f"High failure risk. Schedule preventive service within the next "
            f"{days} day{'s' if days != 1 else ''} to protect uptime.",
        )
    if prob >= 0.2:
        return (
            "Medium",
            "Elevated risk. Plan service within 2-3 weeks and monitor health "
            "index daily for further degradation.",
        )
    return (
        "Low",
        "Low risk. No action required; continue routine monitoring.",
    )


def score(feature_values: dict) -> dict:
    """Run predict_proba on a single tool's features.

    feature_values: mapping of feature name -> numeric value.
    Returns failure risk %, band, and a recommendation.
    """
    if _model is None:
        raise RuntimeError("Model not loaded")
    # Build a single-row DataFrame in the exact trained feature order so the
    # model matches its fitted feature names (avoids silent mis-ordering).
    row = {name: float(feature_values[name]) for name in _features}
    X = pd.DataFrame([row], columns=_features)
    prob = float(_model.predict_proba(X)[:, 1][0])
    band, reco = _band_and_reco(prob)
    return {
        "failure_risk_7d": prob,
        "failure_risk_pct": round(prob * 100, 1),
        "risk_band": band,
        "recommendation": reco,
    }
