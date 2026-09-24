"""Live failure-risk scoring using the exported scikit-learn model."""
import json
import os
import joblib
import pandas as pd
from server.config import MODEL_DIR

_model = None
_features = None


def load_model():
    """Load the pickled sklearn model + feature order at startup."""
    global _model, _features
    if _model is not None:
        return
    with open(os.path.join(MODEL_DIR, "pm_features.json")) as f:
        _features = json.load(f)
    _model = joblib.load(os.path.join(MODEL_DIR, "pm_model.pkl"))


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
